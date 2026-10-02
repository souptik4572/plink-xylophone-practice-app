"""SQLModel tables. One SQLite file holds everything Plink keeps."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, Session, SQLModel, create_engine

from app import config


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
    created_at: datetime = Field(default_factory=_now)


engine = create_engine(f"sqlite:///{config.DB_PATH}", connect_args={"check_same_thread": False})


def init_db(eng=engine) -> None:
    SQLModel.metadata.create_all(eng)


def get_session():
    with Session(engine) as session:
        yield session
