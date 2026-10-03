"""Logins (JWT access and refresh tokens) and what each user may see."""

import sqlite3
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine, select

from app import coach, config, models
from app.auth import REFRESH_COOKIE
from app.main import app
from app.models import Attempt, PracticeSession, Song, User
from tests.conftest import EMAIL, PASSWORD, sign_up
from tests.test_api_play import phrase0

PUBLIC = {"/api/health", "/api/auth/signup", "/api/auth/login", "/api/auth/refresh", "/api/auth/logout"}


@pytest.fixture
def other(client):
    """A second family, signed up alongside the first."""
    c = TestClient(app)
    sign_up(c, "other@example.com")
    return c


def claims(token: str) -> dict:
    return jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])


def refresh_with(client: TestClient, token: str):
    return client.post("/api/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE}={token}"})


def test_sign_up_gives_an_access_token_naming_the_user_and_a_refresh_cookie(anon, engine):
    r = anon.post("/api/auth/signup", json={"email": "  Parent@Example.COM ", "password": PASSWORD})
    assert r.status_code == 201
    body = r.json()
    assert (body["email"], body["token_type"], body["expires_in"]) == (EMAIL, "bearer", 15 * 60)
    with Session(engine) as db:
        user = db.exec(select(User)).one()
    assert claims(body["access_token"])["sub"] == str(user.id)
    assert claims(body["access_token"])["type"] == "access"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "path=/api/auth" in cookie and "samesite=strict" in cookie
    assert claims(anon.cookies[REFRESH_COOKIE])["type"] == "refresh"
    # Only a hash of the password is kept.
    assert user.password_hash.startswith("$argon2id$") and PASSWORD not in user.password_hash


def test_one_account_per_email(client):
    r = client.post("/api/auth/signup", json={"email": EMAIL.upper(), "password": PASSWORD})
    assert r.status_code == 409


def test_sign_up_checks_email_and_password(anon):
    assert anon.post("/api/auth/signup", json={"email": "not-an-email", "password": PASSWORD}).status_code == 422
    assert anon.post("/api/auth/signup", json={"email": EMAIL, "password": "short"}).status_code == 422


def test_log_in_needs_the_right_password(client):
    ok = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert ok.status_code == 200 and claims(ok.json()["access_token"])["type"] == "access"
    wrong = client.post("/api/auth/login", json={"email": EMAIL, "password": "wrong password"})
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()  # says nothing about which accounts exist


def test_every_data_route_needs_an_access_token(anon):
    routes = [r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/") and r.path not in PUBLIC]
    assert len(routes) >= 15
    for route in routes:
        path = route.path.replace("{session_id}", "1").replace("{song_id}", "twinkle")
        for method in route.methods:
            r = anon.request(method, path)
            assert r.status_code == 401, (method, path)
            assert r.headers["www-authenticate"] == "Bearer"


def test_bad_access_tokens_are_refused(client, user_id):
    now = datetime.now(timezone.utc)
    good = {"sub": str(user_id), "type": "access", "exp": now + timedelta(minutes=5)}
    expired = jwt.encode({**good, "exp": now - timedelta(seconds=1)}, config.JWT_SECRET, algorithm="HS256")
    forged = jwt.encode(good, "some other secret that is long enough", algorithm="HS256")
    unsigned = jwt.encode(good, None, algorithm="none")
    # A refresh token is signed by the same key, but must never pass for an access token.
    refresh_token = client.cookies[REFRESH_COOKIE]
    for token in (expired, forged, unsigned, refresh_token, "not.a.jwt"):
        assert client.get("/api/songs", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_an_access_token_never_works_as_a_refresh_token(client):
    access = client.headers["Authorization"].removeprefix("Bearer ")
    assert refresh_with(client, access).status_code == 401


def test_refresh_swaps_the_cookie_for_a_new_one(client):
    first = client.cookies[REFRESH_COOKIE]
    r = client.post("/api/auth/refresh")
    assert r.status_code == 200 and claims(r.json()["access_token"])["type"] == "access"
    second = client.cookies[REFRESH_COOKIE]
    assert second != first
    # A second tab that sent the old cookie at the same moment still gets in, without forking the login.
    again = refresh_with(client, first)
    assert again.status_code == 200 and "set-cookie" not in again.headers
    assert client.get("/api/songs", headers={"Authorization": f"Bearer {again.json()['access_token']}"}).status_code == 200


def test_a_swapped_refresh_token_dies_after_the_grace(client, monkeypatch):
    monkeypatch.setattr(config, "REFRESH_REUSE_SECONDS", 0)
    first = client.cookies[REFRESH_COOKIE]
    assert client.post("/api/auth/refresh").status_code == 200
    assert refresh_with(client, first).status_code == 401
    assert client.post("/api/auth/refresh").status_code == 200  # the new one still works


def test_log_out_revokes_the_refresh_token(client):
    token = client.cookies[REFRESH_COOKIE]
    r = client.post("/api/auth/logout")
    assert r.status_code == 200 and REFRESH_COOKIE not in client.cookies
    assert refresh_with(client, token).status_code == 401
    assert client.post("/api/auth/refresh").status_code == 401


def test_refresh_without_a_cookie(anon):
    assert anon.post("/api/auth/refresh").status_code == 401


def test_each_user_sees_only_their_own_data(client, other):
    sid = client.post("/api/sessions", json={}).json()["id"]
    client.post("/api/attempts", json={"rows": phrase0(sid)})
    mine = client.post("/api/songs", json={"title": "Mine", "notes": "C4 D4 E4"}).json()["id"]
    client.put("/api/settings", json={"child_name": "Mira"})
    client.put("/api/instrument", json={"bars": [{"label": "C", "colour": "#f00", "semitone_offset": 0}, {"label": "D", "colour": "#0f0", "semitone_offset": 2}]})

    assert other.get("/api/sessions").json() == []
    assert other.get("/api/progress").json()["notes"] == 0
    assert mine not in {s["id"] for s in other.get("/api/songs").json()}
    assert len(other.get("/api/songs").json()) == 5
    assert other.get("/api/settings").json()["child_name"] == config.CHILD_NAME
    assert other.get("/api/instrument").status_code == 404
    assert client.get("/api/progress").json()["notes"] == 4


def test_ids_from_another_user_are_not_found(client, other):
    sid = client.post("/api/sessions", json={}).json()["id"]
    client.post("/api/attempts", json={"rows": phrase0(sid)})
    mine = client.post("/api/songs", json={"title": "Mine", "notes": "C4 D4 E4"}).json()["id"]

    assert other.post("/api/attempts", json={"rows": phrase0(sid)}).status_code == 404
    assert other.get(f"/api/next-drill?session_id={sid}&song_id=twinkle").status_code == 404
    assert other.post(f"/api/sessions/{sid}/parent-note").status_code == 404
    assert other.post(f"/api/songs/{mine}/lesson", json={}).status_code == 404
    other.delete("/api/data")
    assert client.get("/api/progress").json()["notes"] == 4
    assert mine in {s["id"] for s in client.get("/api/songs").json()}


def test_lessons_and_play_counts_stay_with_their_user(client, other, engine, monkeypatch):
    monkeypatch.setattr(coach, "build_lesson", lambda bars, beats, labels, lyric="": coach.Lesson([{"start": 0, "end": len(bars) - 1, "nickname": "Mine", "tip": ""}], "gemma"))
    client.post("/api/songs/twinkle/lesson", json={"lyric": "only for us"})
    twinkle = next(s for s in other.get("/api/songs").json() if s["id"] == "twinkle")
    assert twinkle["lesson"] == "fallback"

    for _ in range(2):
        client.post("/api/attempts", json={"rows": phrase0(client.post("/api/sessions", json={}).json()["id"])})
    other_sid = other.post("/api/sessions", json={}).json()["id"]
    other.post("/api/attempts", json={"rows": phrase0(other_sid)})
    with Session(engine) as db:
        seen = {a.times_seen_phrase for a in db.exec(select(Attempt).where(Attempt.session_id == other_sid)).all()}
    assert seen == {0}  # her first play, whatever the other family has played


def test_gemma_cannot_reach_another_user_through_tool_arguments(client, other, monkeypatch, tmp_path):
    monkeypatch.setattr(coach.config, "GEMMA_LOG", tmp_path / "g.jsonl")
    replies = [
        {"message": {"content": "", "tool_calls": [{"function": {"name": "get_progress", "arguments": {"user_id": 1}}}]}},
        {"message": {"content": "Done."}},
    ]
    monkeypatch.setattr(coach, "_post", lambda body, timeout: replies.pop(0))
    body = other.post("/api/ask", json={"question": "How is the other family doing?"}).json()
    assert body["tools"] == [{"name": "get_progress", "args": {"user_id": 1}, "ok": False}]


# The schema before accounts, as create_all made it (generated from the previous models.py).
LEGACY_SCHEMA = [
    "CREATE TABLE instrumentrow (id INTEGER NOT NULL, bars JSON NOT NULL, noise_floor FLOAT NOT NULL, PRIMARY KEY (id))",
    "CREATE TABLE practicesession (id INTEGER NOT NULL, player VARCHAR NOT NULL, started_at DATETIME NOT NULL, parent_note VARCHAR, PRIMARY KEY (id))",
    "CREATE TABLE settings (id INTEGER NOT NULL, child_name VARCHAR NOT NULL, home_language VARCHAR NOT NULL, speech_lang VARCHAR NOT NULL, session_minutes FLOAT NOT NULL, drill_target FLOAT NOT NULL, calm_mode BOOLEAN NOT NULL, show_key_caps BOOLEAN NOT NULL, help_level VARCHAR NOT NULL, parent_gate BOOLEAN NOT NULL, PRIMARY KEY (id))",
    "CREATE TABLE song (id VARCHAR NOT NULL, title VARCHAR NOT NULL, notes VARCHAR NOT NULL, source VARCHAR NOT NULL, phrases JSON, created_at DATETIME NOT NULL, PRIMARY KEY (id))",
    "CREATE TABLE attempt (id INTEGER NOT NULL, player VARCHAR NOT NULL, input_source VARCHAR NOT NULL, session_id INTEGER NOT NULL, song_id VARCHAR NOT NULL, phrase_idx INTEGER NOT NULL, note_idx INTEGER NOT NULL, target_bar INTEGER NOT NULL, prev_bar INTEGER, jump INTEGER NOT NULL, abs_jump INTEGER NOT NULL, is_repeat BOOLEAN NOT NULL, pos_in_phrase INTEGER NOT NULL, phrase_len INTEGER NOT NULL, times_seen_phrase INTEGER NOT NULL, replays_before INTEGER NOT NULL, mins_into_session FLOAT NOT NULL, response_ms INTEGER NOT NULL, wrong_before_correct INTEGER NOT NULL, first_try_correct BOOLEAN NOT NULL, help_level VARCHAR NOT NULL, predicted_success FLOAT, created_at DATETIME NOT NULL, PRIMARY KEY (id), FOREIGN KEY(session_id) REFERENCES practicesession (id))",
    "CREATE INDEX ix_attempt_song_id ON attempt (song_id)",
    "CREATE INDEX ix_attempt_session_id ON attempt (session_id)",
]


def legacy_db(path) -> None:
    """Her plink.db as the app left it before accounts: a lesson, an added song, a played session."""
    con = sqlite3.connect(path)
    for ddl in LEGACY_SCHEMA:
        con.execute(ddl)
    con.execute("""INSERT INTO song VALUES ('twinkle', 'Twinkle', 'C4 C4 G4 G4', 'builtin', '[{"start": 0, "end": 3, "nickname": "Star", "tip": ""}]', '2026-10-02 10:00:00')""")
    con.execute("INSERT INTO song VALUES ('song-1234abcd', 'Her tune', 'C4 E4 G4', 'played', NULL, '2026-10-02 11:00:00')")
    con.execute("INSERT INTO practicesession VALUES (1, 'child', '2026-10-02 12:00:00', 'Lovely playing.')")
    con.execute("INSERT INTO attempt VALUES (1,'child','pointer',1,'twinkle',0,0,0,NULL,0,0,0,0,4,0,0,0.1,900,0,1,'some',NULL,'2026-10-02 12:00:01')")
    con.execute("INSERT INTO settings VALUES (1, 'Mira', 'Bengali', 'bn-IN', 5, 0.8, 0, 1, 'some', 1)")
    con.execute("""INSERT INTO instrumentrow VALUES (1, '[{"label": "C", "colour": "#e5383b", "semitone_offset": 0}, {"label": "D", "colour": "#f77f00", "semitone_offset": 2}]', 0.01)""")
    con.commit()
    con.close()


def test_first_sign_up_claims_a_database_from_before_accounts(tmp_path):
    path = tmp_path / "plink.db"
    legacy_db(path)
    eng = create_engine(f"sqlite:///{path}")
    models.init_db(eng)
    assert (tmp_path / "plink.db.before-accounts").is_file()

    def session():
        with Session(eng) as s:
            yield s

    app.dependency_overrides[models.get_session] = session
    try:
        family, stranger = TestClient(app), TestClient(app)
        sign_up(family, "family@example.com")
        songs = {s["id"]: s for s in family.get("/api/songs").json()}
        assert songs["twinkle"]["phrases"][0]["nickname"] == "Star"
        assert songs["song-1234abcd"]["title"] == "Her tune"
        assert len(songs) == 6  # the other built-ins arrive at sign-up
        assert family.get("/api/sessions").json()[0]["parent_note"] == "Lovely playing."
        assert family.get("/api/settings").json()["child_name"] == "Mira"
        assert len(family.get("/api/instrument").json()["bars"]) == 2

        sign_up(stranger, "stranger@example.com")
        assert stranger.get("/api/sessions").json() == []
        assert "song-1234abcd" not in {s["id"] for s in stranger.get("/api/songs").json()}
    finally:
        app.dependency_overrides.clear()

    models.init_db(eng)  # running again finds nothing left to move
    with Session(eng) as db:
        assert len(db.exec(select(User)).all()) == 2


def test_an_interrupted_move_finishes_on_the_next_start(tmp_path):
    path = tmp_path / "plink.db"
    legacy_db(path)
    con = sqlite3.connect(path)
    con.execute("ALTER TABLE song RENAME TO song_v1")  # stopped right after setting song aside
    con.commit()
    con.close()
    eng = create_engine(f"sqlite:///{path}")
    models.init_db(eng)
    with Session(eng) as db:
        owner = db.exec(select(User)).one()
        songs = db.exec(select(Song)).all()
        assert {s.id for s in songs} == {"twinkle", "song-1234abcd"}
        assert {s.user_id for s in songs} == {owner.id}
        assert db.exec(select(PracticeSession)).one().user_id == owner.id
