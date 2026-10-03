"""Every backend threshold and setting lives here, read once from the environment."""

import os
import re
import secrets
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
# Set on Render: Gemma runs on Google's Gemini API instead of Ollama. Empty keeps it offline.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"
# An Ollama tag, or the Gemini API's name for the model when it runs there. Of the API's two
# Gemma 4 models, the mixture-of-experts one read cards and built lessons as well as
# gemma-4-31b-it in testing, and answered 5-10x faster.
GEMMA_MODEL = os.getenv("GEMINI_MODEL", "gemma-4-26b-a4b-it") if GEMINI_API_KEY else os.getenv("GEMMA_MODEL", "gemma4:e4b")
GEMMA_TIMEOUT_S = float(os.getenv("GEMMA_TIMEOUT_S", "30"))
# A lesson is built once per song, never during play. A 42-note tune needs ~580
# tokens, ~27 s at ~22 tok/s on e4b here, so 30 s is too tight for longer songs.
GEMMA_LESSON_TIMEOUT_S = float(os.getenv("GEMMA_LESSON_TIMEOUT_S", "60"))
# Reading a song card: a one-off import. Counting circles needs thinking on (~17 s).
GEMMA_VISION_TIMEOUT_S = float(os.getenv("GEMMA_VISION_TIMEOUT_S", "150"))
CARD_MAX_BYTES = 8 * 1024 * 1024
# Gemma 4 thinks before answering by default: 44 s for a lesson vs 10 s without.
GEMMA_THINK = os.getenv("GEMMA_THINK", "false").lower() in ("1", "true", "yes")
# A reply that breaks the rules (a lesson skipping a note, a stray markdown fence) goes
# back once with the validator's complaint before the fixed fallback is used.
GEMMA_REPAIRS = 1
GEMMA_LOG = ROOT / "backend" / "logs" / "gemma.jsonl"

# The family: used in praise lines and the parent note.
CHILD_NAME = os.getenv("CHILD_NAME", "")
HOME_LANGUAGE = os.getenv("HOME_LANGUAGE", "English")
# BCP-47 tag for the browser's speech voice, e.g. en-IN, bn-IN, hi-IN. Empty: browser default.
SPEECH_LANG = os.getenv("SPEECH_LANG", "")

# Drill picker (spec 7.9)
DRILL_TARGET = float(os.getenv("DRILL_TARGET", "0.80"))
# Spec 7.9 said 60 rows. TabPFN is built for tiny tables, so it starts as soon
# as there are 20 rows holding at least a few hits and a few misses to learn from.
COLD_START_MIN_ROWS = int(os.getenv("COLD_START_MIN_ROWS", "20"))
COLD_START_MIN_PER_CLASS = int(os.getenv("COLD_START_MIN_PER_CLASS", "3"))
# Suggest more help when expected first-try success falls this far below the target.
HELP_MORE_MARGIN = 0.2
# TabPFN only judges a help level it has seen her play: at least this many rows there.
HELP_MIN_ROWS = 8

SESSION_MINUTES = float(os.getenv("SESSION_MINUTES", "5"))

# Practice from her trickiest jumps: parts built on her JUMP_DRILLS weakest jumps, one
# slotted in after every DRILL_EVERY_PARTS parts of the song she chose.
JUMP_DRILLS = 2
DRILL_EVERY_PARTS = 3

# Lesson phrases (spec 7.10)
PHRASE_MIN_NOTES = 3
PHRASE_MAX_NOTES = 6
FALLBACK_PHRASE_NOTES = 4

DB_PATH = Path(os.getenv("PLINK_DB", str(ROOT / "backend" / "plink.db")))
# Set on Render, from its Postgres instance; the laptop keeps SQLite. Render hands over
# postgresql://…, and SQLAlchemy needs the psycopg (v3) driver named.
DATABASE_URL = re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", os.getenv("DATABASE_URL", "")) or f"sqlite:///{DB_PATH}"


def _local_jwt_secret() -> str:
    path = ROOT / "backend" / ".jwt-secret"
    if not path.exists():
        path.write_text(secrets.token_urlsafe(48))
        path.chmod(0o600)
    return path.read_text().strip()


# Signs login tokens. Render generates one (render.yaml); the laptop keeps its own in a
# git-ignored file, so restarting the server doesn't log her out.
JWT_SECRET = os.getenv("JWT_SECRET") or _local_jwt_secret()
ACCESS_TOKEN_MINUTES = 15
REFRESH_TOKEN_DAYS = 30
# Two tabs can refresh with the same cookie at once; the slower one may still use it this long after it was rotated.
REFRESH_REUSE_SECONDS = 30
# The public demo fills each new account with simulated practice (eval/seed_demo.py).
DEMO_SEED = os.getenv("DEMO_SEED", "false").lower() in ("1", "true", "yes")
BUILTIN_SONGS = ROOT / "frontend" / "src" / "songs" / "builtin.json"
# The built app, which the backend serves in the Render image. Locally, Vite serves it on :5173.
FRONTEND_DIST = ROOT / "frontend" / "dist"

# The spec's default instrument: 8 bars, C major, C to high C.
DEFAULT_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12]
DEFAULT_LABELS = ["C", "D", "E", "F", "G", "A", "B", "C′"]
# The default instrument's colours (frontend instrument.ts), so cards can be read by colour.
DEFAULT_COLOURS = {
    "#e5383b": "red",
    "#f77f00": "orange",
    "#fcbf49": "yellow",
    "#5cb85c": "green",
    "#2ec4b6": "turquoise",
    "#3a86ff": "blue",
    "#8e5bd8": "purple",
    "#e05297": "pink",
}
