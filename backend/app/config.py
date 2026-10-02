"""Every backend threshold and setting lives here, read once from the environment."""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

GEMMA_MODEL = os.getenv("GEMMA_MODEL", "gemma4:e4b")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
GEMMA_TIMEOUT_S = float(os.getenv("GEMMA_TIMEOUT_S", "30"))
# A lesson is built once per song, never during play. A 42-note tune needs ~580
# tokens, ~27 s at ~22 tok/s on e4b here, so 30 s is too tight for longer songs.
GEMMA_LESSON_TIMEOUT_S = float(os.getenv("GEMMA_LESSON_TIMEOUT_S", "60"))
# Gemma 4 thinks before answering by default: 44 s for a lesson vs 10 s without.
GEMMA_THINK = os.getenv("GEMMA_THINK", "false").lower() in ("1", "true", "yes")
GEMMA_LOG = ROOT / "backend" / "logs" / "gemma.jsonl"

# The family: used in praise lines and the parent note.
CHILD_NAME = os.getenv("CHILD_NAME", "")
HOME_LANGUAGE = os.getenv("HOME_LANGUAGE", "English")
# BCP-47 tag for the browser's speech voice, e.g. en-IN, bn-IN, hi-IN. Empty: browser default.
SPEECH_LANG = os.getenv("SPEECH_LANG", "")

# Drill picker (spec 7.9)
DRILL_TARGET = float(os.getenv("DRILL_TARGET", "0.80"))
COLD_START_MIN_ROWS = int(os.getenv("COLD_START_MIN_ROWS", "60"))

SESSION_MINUTES = float(os.getenv("SESSION_MINUTES", "5"))

# Lesson phrases (spec 7.10)
PHRASE_MIN_NOTES = 3
PHRASE_MAX_NOTES = 6
FALLBACK_PHRASE_NOTES = 4

DB_PATH = Path(os.getenv("PLINK_DB", str(ROOT / "backend" / "plink.db")))
BUILTIN_SONGS = ROOT / "frontend" / "src" / "songs" / "builtin.json"

# The spec's default instrument: 8 bars, C major, C to high C.
DEFAULT_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12]
DEFAULT_LABELS = ["C", "D", "E", "F", "G", "A", "B", "C′"]
