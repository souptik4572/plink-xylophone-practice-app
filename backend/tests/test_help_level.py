import sqlite3

from sqlalchemy import inspect
from sqlmodel import Session, create_engine, select

from app import models
from app.features import FEATURES, candidate_rows
from app.models import Attempt
from tests.test_api_play import phrase0


def test_help_level_is_a_feature_and_reaches_candidate_rows():
    assert "help_level" in FEATURES
    rows = candidate_rows([0, 2, 4], times_seen=0, input_source="pointer", mins_into_session=1.0, help_level="little")
    assert set(rows["help_level"]) == {"little"}


def test_attempts_record_help_level_default_some(client, engine):
    sid = client.post("/api/sessions", json={}).json()["id"]
    rows = phrase0(sid)
    rows[0]["help_level"] = "lots"
    assert client.post("/api/attempts", json={"rows": rows}).status_code == 200
    with Session(engine) as db:
        levels = [a.help_level for a in db.exec(select(Attempt).order_by(Attempt.id)).all()]
    assert levels == ["lots", "some", "some", "some"]


def test_unknown_help_level_is_rejected(client):
    sid = client.post("/api/sessions", json={}).json()["id"]
    rows = phrase0(sid)
    rows[0]["help_level"] = "max"
    assert client.post("/api/attempts", json={"rows": rows}).status_code == 422


def test_settings_carry_help_level_and_gate(client):
    s = client.get("/api/settings").json()
    assert (s["help_level"], s["parent_gate"]) == ("some", True)
    s = client.put("/api/settings", json={"help_level": "lots", "parent_gate": False}).json()
    assert (s["help_level"], s["parent_gate"]) == ("lots", False)
    assert client.put("/api/settings", json={"help_level": "max"}).status_code == 422


def test_progress_counts_stars(client):
    sid = client.post("/api/sessions", json={"player": "child"}).json()["id"]
    client.post("/api/attempts", json={"rows": phrase0(sid)})  # 3 of 4 first try
    assert client.get("/api/progress").json()["stars"] == 3


def test_existing_database_gains_new_columns(tmp_path):
    """A plink.db from before help levels: init_db adds the columns, old rows read as 'some'."""
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE settings (id INTEGER PRIMARY KEY, child_name VARCHAR, home_language VARCHAR, speech_lang VARCHAR, session_minutes FLOAT, drill_target FLOAT, calm_mode BOOLEAN, show_key_caps BOOLEAN)")
    con.execute("INSERT INTO settings VALUES (1, 'Mira', 'English', '', 5, 0.8, 0, 1)")
    cols = "id INTEGER PRIMARY KEY, player VARCHAR, input_source VARCHAR, session_id INTEGER, song_id VARCHAR, phrase_idx INTEGER, note_idx INTEGER, target_bar INTEGER, prev_bar INTEGER, jump INTEGER, abs_jump INTEGER, is_repeat BOOLEAN, pos_in_phrase INTEGER, phrase_len INTEGER, times_seen_phrase INTEGER, replays_before INTEGER, mins_into_session FLOAT, response_ms INTEGER, wrong_before_correct INTEGER, first_try_correct BOOLEAN, created_at DATETIME"
    con.execute(f"CREATE TABLE attempt ({cols})")
    con.execute("INSERT INTO attempt VALUES (1,'child','pointer',1,'twinkle',0,0,0,NULL,0,0,0,0,4,0,0,0.1,900,0,1,'2026-10-02 10:00:00')")
    con.commit()
    con.close()

    eng = create_engine(f"sqlite:///{path}")
    models.init_db(eng)
    assert "help_level" in {c["name"] for c in inspect(eng).get_columns("attempt")}
    assert {"help_level", "parent_gate"} <= {c["name"] for c in inspect(eng).get_columns("settings")}
    with Session(eng) as db:
        assert db.get(Attempt, 1).help_level == "some"
        s = models.get_settings(db)
        assert (s.child_name, s.help_level, s.parent_gate) == ("Mira", "some", True)
    models.init_db(eng)  # running again is harmless
