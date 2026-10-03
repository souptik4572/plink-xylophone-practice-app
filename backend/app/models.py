"""SQLModel tables: SQLite on the laptop, Postgres on Render. Every row of practice belongs to a user."""

import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Column, insert, inspect, text
from sqlmodel import Field, Session, SQLModel, create_engine, select

from app import config
from app.coach import fallback_phrases
from app.fitter import parse_notes


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    """A family's login. The email is empty only on a user no one has claimed yet (see init_db)."""

    __tablename__ = "users"  # "user" is reserved in Postgres
    id: int | None = Field(default=None, primary_key=True)
    email: str | None = Field(default=None, unique=True, index=True)
    password_hash: str | None = None
    # The grown-up's own name for the account menu; the child's name lives in Settings.
    display_name: str = ""
    created_at: datetime = Field(default_factory=_now)


class RefreshToken(SQLModel, table=True):
    """A refresh token handed to one browser, by its JWT id, so logging out revokes it."""

    jti: str = Field(primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    expires_at: datetime
    # Set when it is swapped for a new one; it then lives only REFRESH_REUSE_SECONDS longer.
    rotated_at: datetime | None = None
    created_at: datetime = Field(default_factory=_now)


class InstrumentRow(SQLModel, table=True):
    """Her xylophone: one row per user holding bars low to high, with calibration."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", unique=True, index=True)
    bars: list[dict[str, Any]] = Field(sa_column=Column(JSON, nullable=False))
    noise_floor: float = 0.0


class Song(SQLModel, table=True):
    # Every user has its own copy of the built-ins, so a lesson built for one family never reaches another.
    user_id: int = Field(foreign_key="users.id", primary_key=True)
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
    user_id: int = Field(foreign_key="users.id", index=True)
    player: str = "child"  # child | tester; tester rows never train her model
    started_at: datetime = Field(default_factory=_now)
    parent_note: str | None = None


class Attempt(SQLModel, table=True):
    """One row per expected note: the TabPFN table (spec 7.8)."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
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
    # TabPFN's first-try prediction for this note when the part was picked (not a feature): for calibration.
    predicted_success: float | None = None
    created_at: datetime = Field(default_factory=_now)


class Settings(SQLModel, table=True):
    """The grown-ups' settings: one row per user. Defaults come from .env."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", unique=True, index=True)
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


def get_settings(db: Session, user_id: int) -> Settings:
    return db.exec(select(Settings).where(Settings.user_id == user_id)).first() or Settings(user_id=user_id)


def instrument_row(db: Session, user_id: int) -> InstrumentRow | None:
    return db.exec(select(InstrumentRow).where(InstrumentRow.user_id == user_id)).first()


def bar_offsets(db: Session, user_id: int) -> list[int]:
    row = instrument_row(db, user_id)
    return [b["semitone_offset"] for b in row.bars] if row else config.DEFAULT_OFFSETS


def bar_labels(db: Session, user_id: int) -> list[str]:
    row = instrument_row(db, user_id)
    return [b["label"] for b in row.bars] if row else config.DEFAULT_LABELS


def bar_legend(db: Session, user_id: int) -> list[dict[str, Any]]:
    """Her bars with colour names, for reading song cards. Older saves lack names; the colours give them back."""
    row = instrument_row(db, user_id)
    if row is None:
        return [{"label": lab, "colour_name": name} for lab, name in zip(config.DEFAULT_LABELS, config.DEFAULT_COLOURS.values())]
    return [{"label": b["label"], "colour_name": b.get("colour_name") or config.DEFAULT_COLOURS.get(b["colour"].lower())} for b in row.bars]


def song_phrases(song: Song) -> list[dict[str, Any]]:
    """Gemma's lesson if built, else fixed four-note phrases."""
    return song.phrases or fallback_phrases(len(parse_notes(song.notes)))


_sqlite = config.DATABASE_URL.startswith("sqlite")
# Pre-ping replaces pooled connections that Render's Postgres closed, e.g. in maintenance.
engine = create_engine(
    config.DATABASE_URL,
    connect_args={"check_same_thread": False} if _sqlite else {},
    pool_pre_ping=not _sqlite,
)


# Columns added after the first release. create_all makes new tables but never
# alters old ones, so an existing plink.db gains these here, with safe defaults.
ADDED_COLUMNS = {
    "attempt": [
        ("help_level", "VARCHAR NOT NULL DEFAULT 'some'"),
        ("predicted_success", "FLOAT"),
        ("user_id", "INTEGER REFERENCES users (id)"),
    ],
    "settings": [
        ("help_level", "VARCHAR NOT NULL DEFAULT 'some'"),
        ("parent_gate", "BOOLEAN NOT NULL DEFAULT 1"),
        ("user_id", "INTEGER REFERENCES users (id)"),
    ],
    "practicesession": [("user_id", "INTEGER REFERENCES users (id)")],
    "instrumentrow": [("user_id", "INTEGER REFERENCES users (id)")],
    "users": [("display_name", "VARCHAR NOT NULL DEFAULT ''")],
}


def _columns(con, table: str) -> set[str]:
    return {c["name"] for c in inspect(con).get_columns(table)} if inspect(con).has_table(table) else set()


def init_db(eng=engine) -> None:
    with eng.begin() as con:
        song = _columns(con, "song")
        if song and "user_id" not in song:
            # A plink.db from before accounts, holding her practice. Keep a copy, then set
            # song aside: its primary key gains user_id, which SQLite can't alter in place.
            if eng.url.database and Path(eng.url.database).is_file():
                shutil.copy2(eng.url.database, f"{eng.url.database}.before-accounts")
            con.execute(text("ALTER TABLE song RENAME TO song_v1"))
    SQLModel.metadata.create_all(eng)
    with eng.begin() as con:
        for table, columns in ADDED_COLUMNS.items():
            have = _columns(con, table)
            for name, ddl in columns:
                if name not in have:
                    con.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
        # Rows from before accounts have no owner. They all go to one user with no email,
        # whom the first sign-up claims. Judged by the rows, so an interrupted move finishes next start.
        owned = ("practicesession", "attempt", "settings", "instrumentrow")
        song_v1 = inspect(con).has_table("song_v1")
        if song_v1 or any(con.execute(text(f"SELECT 1 FROM {t} WHERE user_id IS NULL")).first() for t in owned):
            owner = con.execute(insert(User)).inserted_primary_key[0]
            for table in owned:
                con.execute(text(f"UPDATE {table} SET user_id = :owner WHERE user_id IS NULL"), {"owner": owner})
            if song_v1:
                con.execute(
                    text(
                        "INSERT INTO song (user_id, id, title, notes, source, phrases, created_at) "
                        "SELECT :owner, id, title, notes, source, phrases, created_at FROM song_v1"
                    ),
                    {"owner": owner},
                )
                con.execute(text("DROP TABLE song_v1"))
        # create_all indexes only the tables it creates; columns added above need theirs too.
        for table in SQLModel.metadata.sorted_tables:
            for index in table.indexes:
                index.create(con, checkfirst=True)


def get_session():
    with Session(engine) as session:
        yield session
