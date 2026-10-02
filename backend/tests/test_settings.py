from datetime import datetime, timedelta, timezone

from sqlmodel import Session

from app import config
from app.models import PracticeSession
from tests.test_api_play import phrase0


def test_settings_default_from_env(client):
    s = client.get("/api/settings").json()
    assert s["session_minutes"] == config.SESSION_MINUTES
    assert s["drill_target"] == config.DRILL_TARGET
    assert s["calm_mode"] is False and s["show_key_caps"] is True


def test_settings_round_trip(client):
    body = {
        "child_name": "Mira",
        "home_language": "Bengali",
        "speech_lang": "bn-IN",
        "session_minutes": 7,
        "drill_target": 0.7,
        "calm_mode": True,
        "show_key_caps": False,
        "help_level": "little",
        "parent_gate": False,
    }
    assert client.put("/api/settings", json=body).json() == body
    assert client.get("/api/settings").json() == body


def test_settings_are_validated(client):
    assert client.put("/api/settings", json={"session_minutes": 0}).status_code == 422
    assert client.put("/api/settings", json={"drill_target": 1.2}).status_code == 422
    assert client.put("/api/settings", json={"child_name": "x" * 41}).status_code == 422


def test_partial_update_keeps_other_settings(client):
    client.put("/api/settings", json={"child_name": "Mira"})
    client.put("/api/settings", json={"session_minutes": 3})
    s = client.get("/api/settings").json()
    assert (s["child_name"], s["session_minutes"]) == ("Mira", 3)


def test_progress_totals_and_streak(client, engine):
    today = datetime.now(timezone.utc)
    ids = []
    with Session(engine) as db:
        for days_ago in (0, 1, 3):
            s = PracticeSession(player="child", started_at=today - timedelta(days=days_ago))
            db.add(s)
            db.commit()
            db.refresh(s)
            ids.append(s.id)
    for sid in ids:
        client.post("/api/attempts", json={"rows": phrase0(sid)})
    tester = client.post("/api/sessions", json={"player": "tester"}).json()["id"]
    client.post("/api/attempts", json={"rows": phrase0(tester)})

    p = client.get("/api/progress").json()
    assert p["sessions"] == 3  # tester session not counted
    assert p["notes"] == 12
    assert p["first_try_pct"] == 75
    assert p["practice_days"] == 3
    assert p["streak_days"] == 2  # today and yesterday; the gap breaks it
    assert isinstance(p["weakest_jumps"], list)


def test_progress_when_empty(client):
    p = client.get("/api/progress").json()
    assert (p["sessions"], p["notes"], p["streak_days"], p["weakest_jumps"]) == (0, 0, 0, [])


def test_delete_all_data_forgets_settings(client):
    client.put("/api/settings", json={"child_name": "Mira"})
    client.delete("/api/data")
    assert client.get("/api/settings").json()["child_name"] == config.CHILD_NAME
