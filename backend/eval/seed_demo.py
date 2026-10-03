"""Fill a new user's account with a simulated child's practice, for the public demo on Render.

TabPFN needs 20+ rows before it picks drills, so a fresh account would only show the
song-order fallback. These rows come from eval.simulate and are invented: never
report them as hers. Sign-up runs this only when DEMO_SEED is set (render.yaml),
and it does nothing to a user who has already practised.
"""

import json
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.models import Attempt, PracticeSession
from eval.simulate import simulate


def seed(eng, user_id: int, n_sessions: int = 6) -> int:
    """One simulated session a day, ending today. Returns the attempts added."""
    with Session(eng) as db:
        if db.exec(select(PracticeSession).where(PracticeSession.user_id == user_id)).first():
            return 0
        # A JSON round trip turns numpy scalars into types the database driver can bind, and NaN into None.
        rows = json.loads(simulate(n_sessions).to_json(orient="records"))
        today = datetime.now(timezone.utc)
        sessions = [
            PracticeSession(user_id=user_id, started_at=today - timedelta(days=n_sessions - 1 - i)) for i in range(n_sessions)
        ]
        db.add_all(sessions)
        db.flush()
        for r in rows:
            session_id = sessions[r.pop("session_id")].id
            r["prev_bar"] = None if r["prev_bar"] is None else int(r["prev_bar"])
            db.add(Attempt(**r, user_id=user_id, session_id=session_id, player="child"))
        db.commit()
        return len(rows)
