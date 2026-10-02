"""TabPFN drill picker: fit, predict, choose, cold start (spec 7.9)."""

import logging
import threading
import time
from dataclasses import dataclass

import pandas as pd
from sqlalchemy.engine import Engine
from sqlmodel import Session, col, func, select

from app import config
from app.features import FEATURES, LABEL, candidate_rows, frame
from app.fitter import fit_song, parse_notes
from app.models import Attempt, Song, bar_offsets, song_phrases

log = logging.getLogger("plink.drill")


@dataclass
class Candidate:
    song_id: str
    phrase_idx: int
    rows: pd.DataFrame


@dataclass
class Pick:
    song_id: str
    phrase_idx: int
    source: str  # tabpfn | fallback
    expected_success: float | None
    seconds: float = 0.0


def tabpfn_model():
    from tabpfn import TabPFNClassifier  # imported late: app.config must load .env first

    return TabPFNClassifier()


def next_in_song_order(phrase_count: int, last_phrase: int | None) -> int:
    """Cold start: the phrase after the last one played, wrapping to the start."""
    return 0 if last_phrase is None else (last_phrase + 1) % phrase_count


def choose(expected: list[float], exclude: int | None, target: float = config.DRILL_TARGET) -> int:
    """The phrase whose expected success is closest to the target: mostly wins, one stretch."""
    options = [i for i in range(len(expected)) if i != exclude] or [0]
    return min(options, key=lambda i: (round(abs(expected[i] - target), 9), i))


def pick(history: pd.DataFrame, cands: list[Candidate], last: tuple[str, int] | None, model=tabpfn_model) -> Pick:
    keys = [(c.song_id, c.phrase_idx) for c in cands]
    last_i = keys.index(last) if last in keys else None

    if len(history) < config.COLD_START_MIN_ROWS or history[LABEL].nunique() < 2:
        i = 0 if last_i is None else (last_i + 1) % len(cands)
        return Pick(cands[i].song_id, cands[i].phrase_idx, "fallback", None)

    t = time.perf_counter()
    m = model().fit(history[FEATURES], history[LABEL].astype(int))
    proba = m.predict_proba(pd.concat([c.rows for c in cands], ignore_index=True))[:, list(m.classes_).index(1)]
    expected, at = [], 0
    for c in cands:
        expected.append(float(proba[at : at + len(c.rows)].mean()))
        at += len(c.rows)
    i = choose(expected, last_i)
    return Pick(cands[i].song_id, cands[i].phrase_idx, "tabpfn", expected[i], time.perf_counter() - t)


# ---------- Wiring: once per phrase, off the request path ----------

_lock = threading.Lock()
_cache: dict[tuple[int, str | None], tuple[int, Pick]] = {}


def clear_cache() -> None:
    """Session ids can be reused once data is deleted, so cached picks go with it."""
    with _lock:
        _cache.clear()


def _compute(db: Session, session_id: int, song_id: str | None, last: Attempt | None) -> Pick:
    offsets = bar_offsets(db)
    songs = [db.get(Song, song_id)] if song_id else list(db.exec(select(Song).order_by(col(Song.created_at))).all())
    if not songs or songs[0] is None:
        raise LookupError(song_id)

    plays = {
        (s, p): n
        for s, p, n in db.exec(
            select(Attempt.song_id, Attempt.phrase_idx, func.count())
            .where(Attempt.pos_in_phrase == 0)
            .group_by(Attempt.song_id, Attempt.phrase_idx)
        ).all()
    }
    ctx = {
        "input_source": last.input_source if last else "pointer",
        "mins_into_session": last.mins_into_session if last else 0.0,
    }
    cands = []
    for song in songs:
        bars = fit_song([m for m, _ in parse_notes(song.notes)], offsets).bars
        for i, p in enumerate(song_phrases(song)):
            rows = candidate_rows(bars[p["start"] : p["end"] + 1], plays.get((song.id, i), 0), **ctx)
            cands.append(Candidate(song.id, i, rows))

    child = db.exec(select(Attempt).where(Attempt.player == "child")).all()
    history = frame([r.model_dump(include={*FEATURES, LABEL}) for r in child]) if child else pd.DataFrame(columns=[*FEATURES, LABEL])
    result = pick(history, cands, (last.song_id, last.phrase_idx) if last else None)
    if result.source == "tabpfn":
        log.info("TabPFN picked %s #%d (p=%.2f) in %.2fs on %d rows", result.song_id, result.phrase_idx, result.expected_success, result.seconds, len(history))
    return result


def next_drill(db: Session, session_id: int, song_id: str | None) -> Pick:
    """Cached per session and latest attempt, so the background refresh usually answers it."""
    with _lock:
        last = db.exec(
            select(Attempt).where(Attempt.session_id == session_id).order_by(col(Attempt.id).desc()).limit(1)
        ).first()
        key = (session_id, song_id)
        stamp = last.id if last else 0
        hit = _cache.get(key)
        if hit and hit[0] == stamp:
            return hit[1]
        result = _compute(db, session_id, song_id, last)
        _cache[key] = (stamp, result)
        return result


def refresh(engine: Engine, session_id: int, song_id: str | None) -> None:
    """Background task after each phrase's attempts land: pick the next drill before she asks."""
    try:
        with Session(engine) as db:
            next_drill(db, session_id, song_id)
    except Exception:
        log.exception("Background drill refresh failed")


def warm_up() -> None:
    """Load TabPFN's weights once at startup so the first real pick is not the slow one."""
    try:
        from tabpfn import TabPFNClassifier

        X = pd.DataFrame({"a": [0, 1, 0, 1] * 5})
        TabPFNClassifier().fit(X, [0, 1, 0, 1] * 5).predict_proba(X.head(1))
        log.info("TabPFN warmed up")
    except Exception:
        log.exception("TabPFN warm-up failed; the first pick will load it instead")
