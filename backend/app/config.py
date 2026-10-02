"""Every backend threshold and setting lives here, read once from the environment."""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

GEMMA_MODEL = os.getenv("GEMMA_MODEL", "gemma4:e4b")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
GEMMA_TIMEOUT_S = float(os.getenv("GEMMA_TIMEOUT_S", "30"))

# Drill picker (spec 7.9)
DRILL_TARGET = float(os.getenv("DRILL_TARGET", "0.80"))
COLD_START_MIN_ROWS = int(os.getenv("COLD_START_MIN_ROWS", "60"))

SESSION_MINUTES = float(os.getenv("SESSION_MINUTES", "5"))

# Lesson phrases (spec 7.10)
PHRASE_MIN_NOTES = 3
PHRASE_MAX_NOTES = 6
FALLBACK_PHRASE_NOTES = 4

DB_PATH = Path(os.getenv("PLINK_DB", str(ROOT / "backend" / "plink.db")))
