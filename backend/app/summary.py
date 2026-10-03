"""Her practice in summary: shared by the API and by Ask Plink's tools."""

from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd
from sqlmodel import Session, col, select

from app import drill
from app.features import FEATURES, LABEL, frame, session_stats
from app.models import Attempt, PracticeSession, bar_labels


def child_history(db: Session, user_id: int) -> pd.DataFrame:
    rows = db.exec(select(Attempt).where(Attempt.user_id == user_id, Attempt.player == "child")).all()
    return frame([r.model_dump(include={*FEATURES, LABEL}) for r in rows]) if rows else frame([])


def sessions(db: Session, user_id: int, limit: int = 20) -> list[dict[str, Any]]:
    out = []
    newest = select(PracticeSession).where(PracticeSession.user_id == user_id).order_by(col(PracticeSession.id).desc()).limit(limit)
    for s in db.exec(newest).all():
        rows = [r.model_dump() for r in db.exec(select(Attempt).where(Attempt.session_id == s.id)).all()]
        if rows:
            out.append({"id": s.id, "player": s.player, "started_at": s.started_at.isoformat(), "stats": session_stats(rows), "parent_note": s.parent_note})
    return out


def progress(db: Session, user_id: int) -> dict[str, Any]:
    """Her totals across child sessions, plus the jumps TabPFN expects her to find hardest."""
    rows = db.exec(select(Attempt).where(Attempt.user_id == user_id, Attempt.player == "child")).all()
    session_ids = {r.session_id for r in rows}
    started = db.exec(select(PracticeSession.started_at).where(col(PracticeSession.id).in_(session_ids))).all()
    days = sorted({d.date() for d in started}, reverse=True)
    streak, expect = 0, datetime.now(timezone.utc).date()
    if days and days[0] < expect:
        expect -= timedelta(days=1)  # a streak survives until she misses a whole day
    for d in days:
        if d != expect:
            break
        streak += 1
        expect -= timedelta(days=1)
    n = len(rows)
    return {
        "sessions": len(session_ids),
        "notes": n,
        "first_try_pct": round(100 * sum(r.first_try_correct for r in rows) / n) if n else 0,
        # One star per note right first time: her sticker book fills from these.
        "stars": sum(r.first_try_correct for r in rows),
        "practice_days": len(days),
        "streak_days": streak,
        "weakest_jumps": drill.weakest_jumps(child_history(db, user_id), bar_labels(db, user_id)) if n else [],
    }
