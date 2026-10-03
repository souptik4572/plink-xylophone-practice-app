"""The demo seeder fills a new user's account once, with rows TabPFN can learn from."""

from sqlmodel import Session, select

from app import config
from app.models import Attempt, PracticeSession
from app.summary import child_history
from eval.seed_demo import seed
from tests.conftest import sign_up


def test_seeds_a_users_empty_account_once(engine, user_id):
    added = seed(engine, user_id, n_sessions=2)
    assert added >= config.COLD_START_MIN_ROWS
    with Session(engine) as db:
        assert len(db.exec(select(PracticeSession).where(PracticeSession.user_id == user_id)).all()) == 2
        assert len(db.exec(select(Attempt).where(Attempt.user_id == user_id)).all()) == added
        history = child_history(db, user_id)
    assert len(history) == added
    assert history["prev_bar"].isna().any() and history["first_try_correct"].nunique() == 2
    assert seed(engine, user_id, n_sessions=2) == 0


def test_sign_up_seeds_only_on_the_demo(anon, monkeypatch):
    sign_up(anon, "laptop@example.com")
    assert anon.get("/api/progress").json()["sessions"] == 0
    monkeypatch.setattr(config, "DEMO_SEED", True)
    sign_up(anon, "visitor@example.com")
    p = anon.get("/api/progress").json()
    assert p["sessions"] == 6 and p["notes"] >= config.COLD_START_MIN_ROWS
