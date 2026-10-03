"""Plink API. Binds to 127.0.0.1 except in the Render demo; receives bar indices and timings, never audio."""

import base64
import binascii
import importlib.util
import json
import threading
import uuid
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, func, select, update

from app import config
from app import ask, auth, coach, drill, summary
from app.auth import UserId
from app.features import derive_columns, session_stats
from app.fitter import REFERENCE_MIDI, fit_song, midi_to_name, parse_notes
from app.models import (
    Attempt,
    RefreshToken,
    InstrumentRow,
    PracticeSession,
    Settings,
    Song,
    User,
    bar_labels,
    bar_legend,
    bar_offsets,
    engine,
    get_session,
    get_settings,
    init_db,
    instrument_row,
    song_phrases,
)


def seed_builtin_songs(db: Session, user_id: int) -> None:
    for s in json.loads(config.BUILTIN_SONGS.read_text()):
        if db.get(Song, (user_id, s["id"])) is None:
            db.add(Song(user_id=user_id, id=s["id"], title=s["title"], notes=s["notes"], source="builtin"))
    db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with Session(engine) as db:
        # A built-in added to builtin.json reaches every user, not only new ones.
        for user_id in db.exec(select(User.id)).all():
            seed_builtin_songs(db, user_id)
    threading.Thread(target=drill.warm_up, daemon=True).start()
    yield


app = FastAPI(title="Plink", lifespan=lifespan)
SessionDep = Annotated[Session, Depends(get_session)]


@app.get("/api/health")
def health() -> dict:
    if config.GEMINI_API_KEY:
        # Not asked here: Render probes this path every few seconds, and each probe would be an API call.
        gemma = True
    else:
        try:
            r = httpx.get(f"{config.OLLAMA_URL}/api/tags", timeout=2)
            names = {m["name"] for m in r.json().get("models", [])}
            gemma = config.GEMMA_MODEL in names
        except httpx.HTTPError:
            gemma = False
    tabpfn = importlib.util.find_spec("tabpfn") is not None
    return {"ok": True, "gemma": gemma, "gemma_model": config.GEMMA_MODEL, "tabpfn": tabpfn}


class Credentials(BaseModel):
    email: Annotated[
        str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    ]
    password: str = Field(min_length=8, max_length=128)


@app.post("/api/auth/signup", status_code=201)
def sign_up(body: Credentials, request: Request, response: Response, db: SessionDep) -> dict[str, Any]:
    # The first sign-up on a plink.db from before accounts claims the practice already in it.
    user = db.exec(select(User).where(col(User.email).is_(None))).first() or User()
    user.email, user.password_hash = body.email, auth.hash_password(body.password)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as e:
        raise HTTPException(409, "There is already an account with this email") from e
    seed_builtin_songs(db, user.id)
    if config.DEMO_SEED:
        from eval.seed_demo import seed  # the public demo only: invented practice, never hers

        seed(db.get_bind(), user.id)
    return auth.log_in(db, user, request, response)


@app.post("/api/auth/login")
def log_in(body: Credentials, request: Request, response: Response, db: SessionDep) -> dict[str, Any]:
    user = auth.authenticate(db, body.email, body.password)
    if user is None:
        raise HTTPException(401, "Wrong email or password")
    return auth.log_in(db, user, request, response)


@app.post("/api/auth/refresh")
def refresh_login(request: Request, response: Response, db: SessionDep) -> dict[str, Any]:
    return auth.refresh(db, request, response)


@app.post("/api/auth/logout")
def log_out(request: Request, response: Response, db: SessionDep) -> dict[str, bool]:
    auth.log_out(db, request, response)
    return {"ok": True}


def own_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:  # deleted while its access token still had minutes to run
        raise HTTPException(401, "Log in again")
    return user


def account_out(user: User) -> dict[str, Any]:
    return {
        "email": user.email,
        "display_name": user.display_name,
        "created_at": user.created_at.isoformat(),
        "storage": "sqlite" if config.DATABASE_URL.startswith("sqlite") else "postgres",
        "gemma": {"where": "gemini" if config.GEMINI_API_KEY else "ollama", "model": config.GEMMA_MODEL},
    }


@app.get("/api/account")
def read_account(db: SessionDep, user_id: UserId) -> dict[str, Any]:
    return account_out(own_user(db, user_id))


class AccountIn(BaseModel):
    display_name: str = Field(max_length=40)


@app.put("/api/account")
def write_account(body: AccountIn, db: SessionDep, user_id: UserId) -> dict[str, Any]:
    user = own_user(db, user_id)
    user.display_name = body.display_name.strip()
    db.add(user)
    db.commit()
    return account_out(user)


class PasswordIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)


@app.delete("/api/account")
def delete_account(body: PasswordIn, request: Request, response: Response, db: SessionDep, user_id: UserId) -> dict[str, bool]:
    """The login and everything it owns. Asks for the password again, as nothing brings it back."""
    user = own_user(db, user_id)
    if auth.authenticate(db, user.email, body.password) is None:
        # Not 401: the login itself is fine, and the app would take a 401 for an expired one.
        raise HTTPException(403, "Wrong password")
    # In this order: Postgres enforces the foreign keys.
    for model in (Attempt, PracticeSession, InstrumentRow, Settings, Song, RefreshToken):
        db.exec(delete(model).where(col(model.user_id) == user_id))
    db.exec(delete(User).where(col(User.id) == user_id))
    db.commit()
    drill.clear_cache()
    auth.log_out(db, request, response)
    return {"deleted": True}


class SettingsIn(BaseModel):
    child_name: str | None = Field(default=None, max_length=40)
    home_language: str | None = Field(default=None, min_length=2, max_length=40)
    speech_lang: str | None = Field(default=None, max_length=20)
    session_minutes: float | None = Field(default=None, ge=1, le=30)
    drill_target: float | None = Field(default=None, ge=0.5, le=0.95)
    calm_mode: bool | None = None
    show_key_caps: bool | None = None
    help_level: Literal["lots", "some", "little"] | None = None
    parent_gate: bool | None = None


def settings_out(s: Settings) -> dict[str, Any]:
    return s.model_dump(exclude={"id", "user_id"})


@app.get("/api/settings")
def read_settings(db: SessionDep, user_id: UserId) -> dict[str, Any]:
    return settings_out(get_settings(db, user_id))


@app.put("/api/settings")
def write_settings(body: SettingsIn, db: SessionDep, user_id: UserId) -> dict[str, Any]:
    s = get_settings(db, user_id)
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(s, key, value.strip() if isinstance(value, str) else value)
    db.add(s)
    db.commit()
    db.refresh(s)
    drill.clear_cache()
    return settings_out(s)



class BarIn(BaseModel):
    label: str
    colour: str
    colour_name: str | None = None
    semitone_offset: int
    template: list[float] | None = None


class InstrumentIn(BaseModel):
    bars: list[BarIn] = Field(min_length=2)
    noise_floor: float = 0.0


@app.get("/api/instrument")
def get_instrument(db: SessionDep, user_id: UserId) -> dict[str, Any]:
    row = instrument_row(db, user_id)
    if row is None:
        raise HTTPException(404, "Not calibrated yet")
    return {"bars": row.bars, "noise_floor": row.noise_floor}


@app.put("/api/instrument")
def put_instrument(body: InstrumentIn, db: SessionDep, user_id: UserId) -> dict[str, Any]:
    offsets = [b.semitone_offset for b in body.bars]
    if offsets != sorted(set(offsets)):
        raise HTTPException(422, "Bars must be listed low to high with distinct pitches")
    row = instrument_row(db, user_id) or InstrumentRow(user_id=user_id, bars=[])
    row.bars = [b.model_dump(exclude_none=True) for b in body.bars]
    row.noise_floor = body.noise_floor
    db.add(row)
    db.commit()
    return {"bars": row.bars, "noise_floor": row.noise_floor}



def parse_or_422(notes: str) -> list[tuple[int, float]]:
    try:
        parsed = parse_notes(notes)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    if not parsed:
        raise HTTPException(422, "A song needs at least one note")
    return parsed


def fit_out(parsed: list[tuple[int, float]], offsets: list[int]) -> dict[str, Any]:
    fit = fit_song([m for m, _ in parsed], offsets)
    return {
        "bars": fit.bars,
        "beats": [b for _, b in parsed],
        "misfits": fit.misfits,
        "fit_score": fit.fit_score,
        "transposition": fit.transposition,
    }


def song_out(song: Song, offsets: list[int]) -> dict[str, Any]:
    parsed = parse_notes(song.notes)
    return {
        "id": song.id,
        "title": song.title,
        "source": song.source,
        "notes": song.notes,
        **fit_out(parsed, offsets),
        "phrases": song_phrases(song),
        "lesson": "gemma" if song.phrases else "fallback",
    }


@app.get("/api/songs")
def list_songs(db: SessionDep, user_id: UserId) -> list[dict[str, Any]]:
    offsets = bar_offsets(db, user_id)
    songs = db.exec(
        select(Song).where(Song.user_id == user_id).order_by(col(Song.source) != "builtin", col(Song.created_at))
    ).all()
    return [song_out(s, offsets) for s in songs]


class SongIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    source: Literal["played", "hummed", "typed", "photo"] = "typed"
    # Either note names ("C4 C4 G4:2") or bar indices on her instrument, with beats.
    notes: str | None = None
    bars: list[int] | None = None
    beats: list[float] | None = None


@app.post("/api/songs")
def create_song(body: SongIn, db: SessionDep, user_id: UserId) -> dict[str, Any]:
    offsets = bar_offsets(db, user_id)
    if body.notes is not None:
        notes = body.notes
    elif body.bars:
        beats = body.beats or [1.0] * len(body.bars)
        if len(beats) != len(body.bars) or any(not 0 <= b < len(offsets) for b in body.bars):
            raise HTTPException(422, "bars and beats must match and be on the instrument")
        notes = " ".join(f"{midi_to_name(REFERENCE_MIDI + offsets[b])}:{beat:g}" for b, beat in zip(body.bars, beats))
    else:
        raise HTTPException(422, "Send notes or bars")
    parse_or_422(notes)
    song = Song(user_id=user_id, id=f"song-{uuid.uuid4().hex[:8]}", title=body.title.strip(), notes=notes, source=body.source)
    db.add(song)
    db.commit()
    return song_out(song, offsets)


class LessonIn(BaseModel):
    lyric: str = Field(default="", max_length=500)


@app.post("/api/songs/{song_id}/lesson")
def build_lesson(song_id: str, body: LessonIn, db: SessionDep, user_id: UserId) -> dict[str, Any]:
    song = db.get(Song, (user_id, song_id))
    if song is None:
        raise HTTPException(404, "No such song")
    parsed = parse_notes(song.notes)
    bars = fit_song([m for m, _ in parsed], bar_offsets(db, user_id)).bars
    lesson = coach.build_lesson(bars, [b for _, b in parsed], bar_labels(db, user_id), body.lyric)
    if lesson.source == "gemma":
        song.phrases = lesson.phrases
        db.add(song)
        db.commit()
        drill.clear_cache()
    return {**song_out(song, bar_offsets(db, user_id)), "lesson_source": lesson.source, "seconds": round(lesson.seconds, 1)}


class CardIn(BaseModel):
    # A data URL or plain base64. The image is read and dropped, never stored.
    image: str = Field(min_length=8)


@app.post("/api/songs/read-card")
def read_card(body: CardIn, db: SessionDep, user_id: UserId) -> dict[str, Any]:
    """Gemma 4 vision reads a photo of a song card; code maps what it saw to her bars."""
    raw = body.image.split(",", 1)[1] if body.image.startswith("data:") else body.image
    try:
        image = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(422, "Not an image") from e
    if len(image) > config.CARD_MAX_BYTES:
        raise HTTPException(413, "That photo is too large")
    legend = bar_legend(db, user_id)
    try:
        card = coach.read_card(image, legend)
    except coach.CardError as e:
        raise HTTPException(503, f"Gemma couldn't read the card: {e}") from e
    mapped = coach.map_card(card.notes, legend)
    return {**mapped, "title": card.title, "beats": [1] * len(mapped["bars"]), "counts": card.counts, "seconds": card.seconds}


class FitIn(BaseModel):
    notes: str


@app.post("/api/songs/fit")
def fit(body: FitIn, db: SessionDep, user_id: UserId) -> dict[str, Any]:
    return fit_out(parse_or_422(body.notes), bar_offsets(db, user_id))



class SessionIn(BaseModel):
    player: Literal["child", "tester"] = "child"


def own_session(db: Session, user_id: int, session_id: int) -> PracticeSession:
    """Another user's session is a 404 too, so its id reveals nothing."""
    s = db.get(PracticeSession, session_id)
    if s is None or s.user_id != user_id:
        raise HTTPException(404, f"No session {session_id}")
    return s


@app.post("/api/sessions")
def start_session(body: SessionIn, db: SessionDep, user_id: UserId) -> dict[str, Any]:
    s = PracticeSession(user_id=user_id, player=body.player)
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "player": s.player, "started_at": s.started_at.isoformat()}


@app.get("/api/sessions")
def list_sessions(db: SessionDep, user_id: UserId, limit: int = 20) -> list[dict[str, Any]]:
    return summary.sessions(db, user_id, limit)


@app.post("/api/sessions/{session_id}/parent-note")
def write_parent_note(session_id: int, db: SessionDep, user_id: UserId) -> dict[str, Any]:
    s = own_session(db, user_id, session_id)
    rows = [r.model_dump() for r in db.exec(select(Attempt).where(Attempt.session_id == session_id)).all()]
    if not rows:
        raise HTTPException(409, "Nothing was played in this session")
    stats = session_stats(rows)
    weak = drill.weakest_jumps(summary.child_history(db, user_id), bar_labels(db, user_id))
    prefs = get_settings(db, user_id)
    note = coach.parent_note(stats, weak, prefs.child_name, prefs.home_language)
    s.parent_note = note.text
    db.add(s)
    db.commit()
    return {"note": note.text, "source": note.source, "seconds": round(note.seconds, 1), "stats": stats, "weakest_jumps": weak}


@app.get("/api/progress")
def progress(db: SessionDep, user_id: UserId) -> dict[str, Any]:
    return summary.progress(db, user_id)


@app.get("/api/insights")
def get_insights(db: SessionDep, user_id: UserId) -> dict[str, Any]:
    """TabPFN's view of her: every song at every help level, and whether to change the help."""
    return drill.insights(db, user_id)


class AskMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    history: list[AskMessage] = Field(default_factory=list, max_length=20)


@app.post("/api/ask")
def ask_plink(body: AskIn, db: SessionDep, user_id: UserId) -> dict[str, Any]:
    """A grown-up's question, answered by Gemma using read-only tools over her data and TabPFN."""
    return ask.answer(db, user_id, body.question.strip(), [m.model_dump() for m in body.history])


@app.post("/api/praise")
def praise(db: SessionDep, user_id: UserId) -> dict[str, Any]:
    prefs = get_settings(db, user_id)
    p = coach.praise_lines(prefs.child_name, prefs.home_language)
    return {"lines": p.lines, "source": p.source}


@app.delete("/api/data")
def delete_all_data(db: SessionDep, user_id: UserId) -> dict[str, bool]:
    """The Parent screen's "delete all data": every attempt, session, added song and calibration. The login stays."""
    # In this order: Postgres enforces attempt -> session foreign keys.
    for model in (Attempt, PracticeSession, InstrumentRow, Settings):
        db.exec(delete(model).where(col(model.user_id) == user_id))
    db.exec(delete(Song).where(col(Song.user_id) == user_id, col(Song.source) != "builtin"))
    db.exec(update(Song).where(col(Song.user_id) == user_id).values(phrases=None))
    db.commit()
    drill.clear_cache()
    return {"deleted": True}


class AttemptIn(BaseModel):
    session_id: int
    song_id: str
    phrase_idx: int = Field(ge=0)
    note_idx: int = Field(ge=0)
    target_bar: int = Field(ge=0)
    prev_bar: int | None = Field(default=None, ge=0)
    pos_in_phrase: int = Field(ge=0)
    phrase_len: int = Field(ge=1)
    input_source: Literal["mic", "pointer", "keyboard"]
    replays_before: int = Field(ge=0)
    mins_into_session: float = Field(ge=0)
    response_ms: int = Field(ge=0)
    wrong_before_correct: int = Field(ge=0)
    first_try_correct: bool
    help_level: Literal["lots", "some", "little"] = "some"
    predicted_success: float | None = Field(default=None, ge=0, le=1)


class AttemptsIn(BaseModel):
    rows: list[AttemptIn] = Field(min_length=1)


@app.post("/api/attempts")
def add_attempts(body: AttemptsIn, db: SessionDep, user_id: UserId, background: BackgroundTasks) -> dict[str, int]:
    seen: dict[tuple[str, int], int] = {}
    for r in body.rows:
        session = own_session(db, user_id, r.session_id)
        key = (r.song_id, r.phrase_idx)
        if key not in seen:
            # Earlier plays of this phrase: one pos-0 row per play.
            seen[key] = db.exec(
                select(func.count())
                .select_from(Attempt)
                .where(
                    Attempt.user_id == user_id,
                    Attempt.song_id == r.song_id,
                    Attempt.phrase_idx == r.phrase_idx,
                    Attempt.pos_in_phrase == 0,
                )
            ).one()
        db.add(
            Attempt(
                **r.model_dump(),
                **derive_columns(r.target_bar, r.prev_bar),
                user_id=user_id,
                player=session.player,
                times_seen_phrase=seen[key],
            )
        )
    db.commit()
    last = body.rows[-1]
    background.add_task(drill.refresh, db.get_bind(), user_id, last.session_id, last.song_id)
    return {"inserted": len(body.rows)}


@app.get("/api/next-drill")
def next_drill(session_id: int, db: SessionDep, user_id: UserId, song_id: str | None = None) -> dict[str, Any]:
    own_session(db, user_id, session_id)
    try:
        p = drill.next_drill(db, user_id, session_id, song_id)
    except LookupError as e:
        raise HTTPException(404, "No such song") from e
    return {
        "song_id": p.song_id,
        "phrase_idx": p.phrase_idx,
        "source": p.source,
        "expected_success": p.expected_success,
        "note_probs": p.note_probs,
        "rows_used": p.rows_used,
    }


# Mounted last, so every /api route above wins. The app uses #routes, so no fallback page is needed.
if config.FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="app")
