"""SQLModel tables. One SQLite file holds everything Plink keeps."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Column, inspect, text
from sqlmodel import Field, Session, SQLModel, create_engine

from app import config
from app.coach import fallback_phrases
from app.fitter import parse_notes


def _now() -> datetime:
    return datetime.now(timezone.utc)


class InstrumentRow(SQLModel, table=True):
    """Her xylophone: a single row holding bars low to high, with calibration."""

    id: int = Field(default=1, primary_key=True)
    bars: list[dict[str, Any]] = Field(sa_column=Column(JSON, nullable=False))
    noise_floor: float = 0.0


class Song(SQLModel, table=True):
    id: str = Field(primary_key=True)
    title: str
    # Note names in the reference key with beats, e.g. "E4 D4 C4:2".
    notes: str
    source: str = "builtin"  # builtin | played | hummed | typed
    # Gemma's lesson: [{start, end (inclusive), nickname, tip}]. None until built.
    phrases: list[dict[str, Any]] | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_now)


class PracticeSession(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    player: str = "child"  # child | tester; tester rows never train her model
    started_at: datetime = Field(default_factory=_now)
    parent_note: str | None = None


class Attempt(SQLModel, table=True):
    """One row per expected note: the TabPFN table (spec 7.8)."""

    id: int | None = Field(default=None, primary_key=True)
    player: str
    input_source: str  # mic | pointer | keyboard
    session_id: int = Field(foreign_key="practicesession.id", index=True)
    song_id: str = Field(index=True)
    phrase_idx: int
    note_idx: int
    target_bar: int
    prev_bar: int | None
    jump: int
    abs_jump: int
    is_repeat: bool
    pos_in_phrase: int
    phrase_len: int
    times_seen_phrase: int
    replays_before: int
    mins_into_session: float
    response_ms: int
    wrong_before_correct: int
    first_try_correct: bool
    # How much help the game gave: lots (only the target sounds), some (glow + hints), little (glow only if stuck).
    help_level: str = "some"
    created_at: datetime = Field(default_factory=_now)


class Settings(SQLModel, table=True):
    """The grown-ups' settings: one row. Defaults come from .env."""

    id: int = Field(default=1, primary_key=True)
    child_name: str = config.CHILD_NAME
    home_language: str = config.HOME_LANGUAGE
    speech_lang: str = config.SPEECH_LANG
    session_minutes: float = config.SESSION_MINUTES
    drill_target: float = config.DRILL_TARGET
    calm_mode: bool = False
    show_key_caps: bool = True
    help_level: str = "some"
    # Ask a grown-up sum before opening the grown-ups' screens.
    parent_gate: bool = True


def get_settings(db: Session) -> Settings:
    return db.get(Settings, 1) or Settings()


def bar_offsets(db: Session) -> list[int]:
    row = db.get(InstrumentRow, 1)
    return [b["semitone_offset"] for b in row.bars] if row else config.DEFAULT_OFFSETS


def bar_labels(db: Session) -> list[str]:
    row = db.get(InstrumentRow, 1)
    return [b["label"] for b in row.bars] if row else config.DEFAULT_LABELS


def song_phrases(song: Song) -> list[dict[str, Any]]:
    """Gemma's lesson if built, else fixed four-note phrases."""
    return song.phrases or fallback_phrases(len(parse_notes(song.notes)))


engine = create_engine(f"sqlite:///{config.DB_PATH}", connect_args={"check_same_thread": False})


# Columns added after the first release. create_all makes new tables but never
# alters old ones, so an existing plink.db gains these here, with safe defaults.
ADDED_COLUMNS = {
    "attempt": [("help_level", "VARCHAR NOT NULL DEFAULT 'some'")],
    "settings": [("help_level", "VARCHAR NOT NULL DEFAULT 'some'"), ("parent_gate", "BOOLEAN NOT NULL DEFAULT 1")],
}


def init_db(eng=engine) -> None:
    SQLModel.metadata.create_all(eng)
    with eng.begin() as con:
        for table, columns in ADDED_COLUMNS.items():
            have = {c["name"] for c in inspect(con).get_columns(table)}
            for name, ddl in columns:
                if name not in have:
                    con.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def get_session():
    with Session(engine) as session:
        yield session
