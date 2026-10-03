"""TabPFN drill picker: fit, predict, choose, cold start (spec 7.9)."""

import hashlib
import json
import logging
import threading
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sqlalchemy.engine import Engine
from sqlmodel import Session, col, func, select

from app import config
from app.features import FEATURES, LABEL, candidate_rows, frame
from app.fitter import fit_song, parse_notes
from app.models import Attempt, Song, bar_offsets, get_settings, song_phrases

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
    # TabPFN's first-try prediction for each note of the chosen part, for per-note help.
    note_probs: list[float] | None = None
    rows_used: int = 0


# PyTorch's GPU (MPS) backend deadlocked when several threads first used a kernel
# at once (three request threads stuck in MetalShaderLibrary::exec_unary_kernel),
# so every TabPFN fit and predict in this process runs under this one lock.
_tabpfn_lock = threading.Lock()


def fit_predict(model, X_train: pd.DataFrame, y: pd.Series, X: pd.DataFrame) -> np.ndarray:
    """P(right first time) for each row of X, from a model fitted on her history."""
    with _tabpfn_lock:
        m = model().fit(X_train, y)
        return m.predict_proba(X)[:, list(m.classes_).index(1)]


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


def cold_start(history: pd.DataFrame) -> bool:
    """Too little to learn from: under 20 rows, or too few hits or misses."""
    if len(history) < config.COLD_START_MIN_ROWS:
        return True
    counts = history[LABEL].astype(bool).value_counts()
    return min(counts.get(True, 0), counts.get(False, 0)) < config.COLD_START_MIN_PER_CLASS


def pick(
    history: pd.DataFrame,
    cands: list[Candidate],
    last: tuple[str, int] | None,
    model=tabpfn_model,
    target: float = config.DRILL_TARGET,
) -> Pick:
    keys = [(c.song_id, c.phrase_idx) for c in cands]
    last_i = keys.index(last) if last in keys else None

    if cold_start(history):
        i = 0 if last_i is None else (last_i + 1) % len(cands)
        return Pick(cands[i].song_id, cands[i].phrase_idx, "fallback", None, rows_used=len(history))

    t = time.perf_counter()
    proba = fit_predict(model, history[FEATURES], history[LABEL].astype(int), pd.concat([c.rows for c in cands], ignore_index=True))
    per_note, at = [], 0
    for c in cands:
        per_note.append([float(x) for x in proba[at : at + len(c.rows)]])
        at += len(c.rows)
    expected = [sum(ps) / len(ps) for ps in per_note]
    i = choose(expected, last_i, target)
    return Pick(
        cands[i].song_id, cands[i].phrase_idx, "tabpfn", expected[i], time.perf_counter() - t, per_note[i], len(history)
    )


def weakest_jumps(history: pd.DataFrame, labels: list[str], k: int = 3, model=tabpfn_model) -> list[dict]:
    """The bar-to-bar moves she is least likely to get right first time.

    With enough rows, TabPFN predicts each jump she has met as a mid-phrase note;
    before that, her observed success rates (smoothed, at least 3 tries) stand in.
    """
    if history.empty:
        return []
    moves = history.dropna(subset=["prev_bar"])
    moves = moves[moves["prev_bar"] != moves["target_bar"]]
    if moves.empty:
        return []
    pairs = moves.groupby(["prev_bar", "target_bar"])[LABEL].agg(["sum", "count"]).reset_index()

    def named(prev, target, expected, source):
        return {"from": labels[int(prev)], "to": labels[int(target)], "expected": float(expected), "source": source}

    if cold_start(history):
        seen = pairs[pairs["count"] >= 3].assign(rate=lambda d: (d["sum"] + 1) / (d["count"] + 2))
        seen = seen.sort_values(["rate", "prev_bar", "target_bar"]).head(k)
        return [named(r.prev_bar, r.target_bar, r.rate, "observed") for r in seen.itertuples()]

    typical = {
        "times_seen": int(history["times_seen_phrase"].median()),
        "input_source": history["input_source"].mode()[0],
        "mins_into_session": float(history["mins_into_session"].median()),
        "help_level": history["help_level"].mode()[0],
    }
    probe = pd.concat(
        [
            candidate_rows([int(p), int(t)], **typical).iloc[[1]]
            for p, t in zip(pairs["prev_bar"], pairs["target_bar"])
        ],
        ignore_index=True,
    )
    pairs["expected"] = fit_predict(model, history[FEATURES], history[LABEL].astype(int), probe[FEATURES])
    worst = pairs.sort_values(["expected", "prev_bar", "target_bar"]).head(k)
    return [named(r.prev_bar, r.target_bar, r.expected, "tabpfn") for r in worst.itertuples()]


_lock = threading.Lock()
_cache: dict[tuple[int, int, str | None], tuple[int, Pick]] = {}


# Help levels from most help to least.
LADDER = ["lots", "some", "little"]


def advise(by_level: dict[str, float], current: str, target: float, known: set[str] | None = None) -> dict:
    """Fading prompts, decided by her predicted success at each help level.

    Less help when she'd still meet the target with it; more help when she is
    expected to fall well short at the current level; otherwise stay. A level
    she has never played is unknown to the model (its prediction just copies
    the levels it has seen), so instead of "ready" it asks her to try it once.
    """
    known = set(LADDER) if known is None else known
    i = LADDER.index(current)
    if i + 1 < len(LADDER) and by_level[current] >= target:
        less = LADDER[i + 1]
        if less not in known:
            return {"suggest": "try", "level": less, "now": by_level[current], "then": None}
        if by_level[less] >= target:
            return {"suggest": "less", "level": less, "now": by_level[current], "then": by_level[less]}
    if i > 0 and by_level[current] < target - config.HELP_MORE_MARGIN:
        return {"suggest": "more", "level": LADDER[i - 1], "now": by_level[current], "then": by_level[LADDER[i - 1]]}
    return {"suggest": "stay", "level": current, "now": by_level[current], "then": None}


# Each user's latest insights, keyed by a hash of what they were computed from.
_insights_cache: dict[int, tuple[str, dict]] = {}


def insights(db: Session, user_id: int) -> dict:
    """One TabPFN fit, then her expected first-try success for every song at every help level."""
    child = db.exec(select(Attempt).where(Attempt.user_id == user_id, Attempt.player == "child").order_by(col(Attempt.id))).all()
    history = frame([r.model_dump(include={*FEATURES, LABEL}) for r in child])
    if cold_start(history):
        return {"source": "fallback", "rows_used": len(history), "songs": [], "help": None}

    prefs = get_settings(db, user_id)
    songs = list(db.exec(select(Song).where(Song.user_id == user_id).order_by(col(Song.created_at))).all())
    offsets = bar_offsets(db, user_id)
    key = hashlib.sha1(
        json.dumps(
            [len(child), child[-1].id, prefs.help_level, prefs.drill_target, offsets, [(s.id, s.notes, s.phrases) for s in songs]],
            default=str,
        ).encode()
    ).hexdigest()
    with _lock:
        hit = _insights_cache.get(user_id)
        if hit and hit[0] == key:
            return hit[1]

    plays = {
        (s, p): n
        for s, p, n in db.exec(
            select(Attempt.song_id, Attempt.phrase_idx, func.count())
            .where(Attempt.user_id == user_id, Attempt.pos_in_phrase == 0)
            .group_by(Attempt.song_id, Attempt.phrase_idx)
        ).all()
    }
    source = child[-1].input_source
    blocks, index = [], []
    for song in songs:
        bars = fit_song([m for m, _ in parse_notes(song.notes)], offsets).bars
        for i, p in enumerate(song_phrases(song)):
            for level in LADDER:
                rows = candidate_rows(bars[p["start"] : p["end"] + 1], plays.get((song.id, i), 0), source, 1.0, level)
                blocks.append(rows)
                index += [(song.id, level)] * len(rows)

    t = time.perf_counter()
    proba = fit_predict(tabpfn_model, history[FEATURES], history[LABEL].astype(int), pd.concat(blocks, ignore_index=True)[FEATURES])
    sums: dict[tuple[str, str], list[float]] = {}
    for k, p in zip(index, proba):
        sums.setdefault(k, []).append(float(p))
    by_song = {s.id: {lv: sum(sums[(s.id, lv)]) / len(sums[(s.id, lv)]) for lv in LADDER} for s in songs}

    rows_by_level = {lv: int((history["help_level"] == lv).sum()) for lv in LADDER}
    known = {lv for lv, n in rows_by_level.items() if n >= config.HELP_MIN_ROWS}
    # Advice is about the song she practises most, at the level she plays now.
    counts: dict[str, int] = {}
    for r in child:
        counts[r.song_id] = counts.get(r.song_id, 0) + 1
    basis = max(counts, key=counts.get)
    out = {
        "source": "tabpfn",
        "rows_used": len(history),
        "seconds": round(time.perf_counter() - t, 2),
        "songs": [
            {"song_id": s, "by_level": lv, "help": advise(lv, prefs.help_level, prefs.drill_target, known)}
            for s, lv in by_song.items()
        ],
        "rows_by_level": rows_by_level,
        "known_levels": [lv for lv in LADDER if lv in known],
        "help": {**advise(by_song[basis], prefs.help_level, prefs.drill_target, known), "basis_song": basis},
    }
    with _lock:
        _insights_cache[user_id] = (key, out)
    return out


def clear_cache() -> None:
    """Session ids can be reused once data is deleted, so cached picks go with it."""
    with _lock:
        _cache.clear()
        _insights_cache.clear()


def _compute(db: Session, user_id: int, session_id: int, song_id: str | None, last: Attempt | None) -> Pick:
    offsets = bar_offsets(db, user_id)
    songs = (
        [db.get(Song, (user_id, song_id))]
        if song_id
        else list(db.exec(select(Song).where(Song.user_id == user_id).order_by(col(Song.created_at))).all())
    )
    if not songs or songs[0] is None:
        raise LookupError(song_id)

    plays = {
        (s, p): n
        for s, p, n in db.exec(
            select(Attempt.song_id, Attempt.phrase_idx, func.count())
            .where(Attempt.user_id == user_id, Attempt.pos_in_phrase == 0)
            .group_by(Attempt.song_id, Attempt.phrase_idx)
        ).all()
    }
    prefs = get_settings(db, user_id)
    ctx = {
        "input_source": last.input_source if last else "pointer",
        "mins_into_session": last.mins_into_session if last else 0.0,
        "help_level": prefs.help_level,
    }
    cands = []
    for song in songs:
        bars = fit_song([m for m, _ in parse_notes(song.notes)], offsets).bars
        for i, p in enumerate(song_phrases(song)):
            rows = candidate_rows(bars[p["start"] : p["end"] + 1], plays.get((song.id, i), 0), **ctx)
            cands.append(Candidate(song.id, i, rows))

    child = db.exec(select(Attempt).where(Attempt.user_id == user_id, Attempt.player == "child")).all()
    history = frame([r.model_dump(include={*FEATURES, LABEL}) for r in child])
    result = pick(history, cands, (last.song_id, last.phrase_idx) if last else None, target=prefs.drill_target)
    if result.source == "tabpfn":
        log.info("TabPFN picked %s #%d (p=%.2f) in %.2fs on %d rows", result.song_id, result.phrase_idx, result.expected_success, result.seconds, len(history))
    return result


def next_drill(db: Session, user_id: int, session_id: int, song_id: str | None) -> Pick:
    """Cached per session and latest attempt, so the background refresh usually answers it."""
    with _lock:
        last = db.exec(
            select(Attempt).where(Attempt.session_id == session_id).order_by(col(Attempt.id).desc()).limit(1)
        ).first()
        key = (user_id, session_id, song_id)
        stamp = last.id if last else 0
        hit = _cache.get(key)
        if hit and hit[0] == stamp:
            return hit[1]
        result = _compute(db, user_id, session_id, song_id, last)
        _cache[key] = (stamp, result)
        return result


def refresh(engine: Engine, user_id: int, session_id: int, song_id: str | None) -> None:
    """Background task after each phrase's attempts land: pick the next drill before she asks."""
    try:
        with Session(engine) as db:
            next_drill(db, user_id, session_id, song_id)
    except Exception:
        log.exception("Background drill refresh failed")


def warm_up() -> None:
    """Load TabPFN's weights once at startup so the first real pick is not the slow one."""
    try:
        from tabpfn import TabPFNClassifier

        X = pd.DataFrame({"a": [0, 1, 0, 1] * 5})
        with _tabpfn_lock:
            TabPFNClassifier().fit(X, [0, 1, 0, 1] * 5).predict_proba(X.head(1))
        log.info("TabPFN warmed up")
    except Exception:
        log.exception("TabPFN warm-up failed; the first pick will load it instead")
