"""Plink local API. Binds to 127.0.0.1 only; receives bar indices and timings, never audio."""

import importlib.util
import json
import uuid
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

import httpx
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, col, func, select

from app import config
from app.coach import fallback_phrases
from app.drill import next_in_song_order
from app.features import derive_columns
from app.fitter import REFERENCE_MIDI, fit_song, midi_to_name, parse_notes
from app.models import Attempt, InstrumentRow, PracticeSession, Song, engine, get_session, init_db


def seed_builtin_songs(db: Session) -> None:
    for s in json.loads(config.BUILTIN_SONGS.read_text()):
        if db.get(Song, s["id"]) is None:
            db.add(Song(id=s["id"], title=s["title"], notes=s["notes"], source="builtin"))
    db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with Session(engine) as db:
        seed_builtin_songs(db)
    yield


app = FastAPI(title="Plink", lifespan=lifespan)
SessionDep = Annotated[Session, Depends(get_session)]


@app.get("/api/health")
def health() -> dict:
    try:
        r = httpx.get(f"{config.OLLAMA_URL}/api/tags", timeout=2)
        names = {m["name"] for m in r.json().get("models", [])}
        ollama = config.GEMMA_MODEL in names
    except httpx.HTTPError:
        ollama = False
    tabpfn = importlib.util.find_spec("tabpfn") is not None
    return {
        "ok": True,
        "ollama": ollama,
        "gemma_model": config.GEMMA_MODEL,
        "tabpfn": tabpfn,
        "session_minutes": config.SESSION_MINUTES,
        "drill_target": config.DRILL_TARGET,
    }


# ---------- Instrument ----------


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
def get_instrument(db: SessionDep) -> dict[str, Any]:
    row = db.get(InstrumentRow, 1)
    if row is None:
        raise HTTPException(404, "Not calibrated yet")
    return {"bars": row.bars, "noise_floor": row.noise_floor}


@app.put("/api/instrument")
def put_instrument(body: InstrumentIn, db: SessionDep) -> dict[str, Any]:
    offsets = [b.semitone_offset for b in body.bars]
    if offsets != sorted(set(offsets)):
        raise HTTPException(422, "Bars must be listed low to high with distinct pitches")
    row = db.get(InstrumentRow, 1) or InstrumentRow(bars=[])
    row.bars = [b.model_dump(exclude_none=True) for b in body.bars]
    row.noise_floor = body.noise_floor
    db.add(row)
    db.commit()
    return {"bars": row.bars, "noise_floor": row.noise_floor}


def bar_offsets(db: Session) -> list[int]:
    row = db.get(InstrumentRow, 1)
    return [b["semitone_offset"] for b in row.bars] if row else config.DEFAULT_OFFSETS


# ---------- Songs ----------


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
        "phrases": song.phrases or fallback_phrases(len(parsed)),
        "lesson": "gemma" if song.phrases else "fallback",
    }


@app.get("/api/songs")
def list_songs(db: SessionDep) -> list[dict[str, Any]]:
    offsets = bar_offsets(db)
    songs = db.exec(select(Song).order_by(col(Song.source) != "builtin", col(Song.created_at))).all()
    return [song_out(s, offsets) for s in songs]


class SongIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    source: Literal["played", "hummed", "typed"] = "typed"
    # Either note names ("C4 C4 G4:2") or bar indices on her instrument, with beats.
    notes: str | None = None
    bars: list[int] | None = None
    beats: list[float] | None = None


@app.post("/api/songs")
def create_song(body: SongIn, db: SessionDep) -> dict[str, Any]:
    offsets = bar_offsets(db)
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
    song = Song(id=f"song-{uuid.uuid4().hex[:8]}", title=body.title.strip(), notes=notes, source=body.source)
    db.add(song)
    db.commit()
    return song_out(song, offsets)


class FitIn(BaseModel):
    notes: str


@app.post("/api/songs/fit")
def fit(body: FitIn, db: SessionDep) -> dict[str, Any]:
    return fit_out(parse_or_422(body.notes), bar_offsets(db))


# ---------- Sessions and attempts ----------


class SessionIn(BaseModel):
    player: Literal["child", "tester"] = "child"


@app.post("/api/sessions")
def start_session(body: SessionIn, db: SessionDep) -> dict[str, Any]:
    s = PracticeSession(player=body.player)
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "player": s.player, "started_at": s.started_at.isoformat()}


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


class AttemptsIn(BaseModel):
    rows: list[AttemptIn] = Field(min_length=1)


@app.post("/api/attempts")
def add_attempts(body: AttemptsIn, db: SessionDep) -> dict[str, int]:
    seen: dict[tuple[str, int], int] = {}
    for r in body.rows:
        session = db.get(PracticeSession, r.session_id)
        if session is None:
            raise HTTPException(404, f"No session {r.session_id}")
        key = (r.song_id, r.phrase_idx)
        if key not in seen:
            # Earlier plays of this phrase: one pos-0 row per play.
            seen[key] = db.exec(
                select(func.count())
                .select_from(Attempt)
                .where(Attempt.song_id == r.song_id, Attempt.phrase_idx == r.phrase_idx, Attempt.pos_in_phrase == 0)
            ).one()
        db.add(
            Attempt(
                **r.model_dump(),
                **derive_columns(r.target_bar, r.prev_bar),
                player=session.player,
                times_seen_phrase=seen[key],
            )
        )
    db.commit()
    return {"inserted": len(body.rows)}


@app.get("/api/next-drill")
def next_drill(session_id: int, db: SessionDep, song_id: str | None = None) -> dict[str, Any]:
    last = db.exec(
        select(Attempt).where(Attempt.session_id == session_id).order_by(col(Attempt.id).desc()).limit(1)
    ).first()
    song = db.get(Song, song_id or (last.song_id if last else "twinkle"))
    if song is None:
        raise HTTPException(404, "No such song")
    phrases = song.phrases or fallback_phrases(len(parse_notes(song.notes)))
    last_phrase = last.phrase_idx if last and last.song_id == song.id else None
    return {
        "song_id": song.id,
        "phrase_idx": next_in_song_order(len(phrases), last_phrase),
        "source": "fallback",
        "expected_success": None,
    }
