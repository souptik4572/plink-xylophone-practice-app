"""The grown-up's account: details, display name, and deleting it with everything it owns."""

import sqlite3

from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlmodel import Session, create_engine, select

from app import config, models
from app.auth import REFRESH_COOKIE
from app.main import app
from app.models import Attempt, PracticeSession, Song, User
from tests.conftest import EMAIL, PASSWORD, sign_up
from tests.test_api_play import phrase0


def test_account_details(client, monkeypatch):
    body = client.get("/api/account").json()
    assert (body["email"], body["display_name"]) == (EMAIL, "")
    assert body["created_at"]
    assert body["storage"] == ("sqlite" if config.DATABASE_URL.startswith("sqlite") else "postgres")
    assert body["gemma"] == {"where": "ollama", "model": config.GEMMA_MODEL}
    monkeypatch.setattr(config, "GEMINI_API_KEY", "set")
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql+psycopg://render")
    body = client.get("/api/account").json()
    assert (body["storage"], body["gemma"]["where"]) == ("postgres", "gemini")


def test_display_name_is_kept_and_comes_with_every_login(client):
    assert client.put("/api/account", json={"display_name": "  Souptik "}).json()["display_name"] == "Souptik"
    assert client.get("/api/account").json()["display_name"] == "Souptik"
    assert client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD}).json()["display_name"] == "Souptik"
    assert client.post("/api/auth/refresh").json()["display_name"] == "Souptik"
    assert client.put("/api/account", json={"display_name": "x" * 41}).status_code == 422


def test_display_names_are_per_user(client):
    other = TestClient(app)
    sign_up(other, "other@example.com")
    client.put("/api/account", json={"display_name": "Parent"})
    assert other.get("/api/account").json()["display_name"] == ""


def test_delete_account_needs_the_password(client, engine):
    r = client.request("DELETE", "/api/account", json={"password": "not my password"})
    assert r.status_code == 403  # not 401: the app would take that for an expired login
    with Session(engine) as db:
        assert db.exec(select(User).where(User.email == EMAIL)).first() is not None


def test_delete_account_removes_the_login_and_everything_it_owns(client, engine):
    other = TestClient(app)
    sign_up(other, "other@example.com")
    for c in (client, other):
        sid = c.post("/api/sessions", json={}).json()["id"]
        c.post("/api/attempts", json={"rows": phrase0(sid)})
        c.post("/api/songs", json={"title": "Mine", "notes": "C4 D4 E4"})
        c.put("/api/settings", json={"child_name": "Mira"})
    refresh = client.cookies[REFRESH_COOKIE]

    r = client.request("DELETE", "/api/account", json={"password": PASSWORD})
    assert r.status_code == 200 and REFRESH_COOKIE not in client.cookies
    with Session(engine) as db:
        left = {u.id for u in db.exec(select(User)).all()}
        assert len(left) == 1 and db.exec(select(User).where(User.email == EMAIL)).first() is None
        for model in (PracticeSession, Attempt, Song):
            assert {r.user_id for r in db.exec(select(model)).all()} == left
    # The refresh token went with it, and the other family keeps everything.
    assert client.post("/api/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE}={refresh}"}).status_code == 401
    assert other.get("/api/progress").json()["notes"] == 4
    assert other.get("/api/settings").json()["child_name"] == "Mira"
    # The email is free again, for a fresh, empty account.
    sign_up(client)
    assert client.get("/api/sessions").json() == []


def test_a_deleted_users_access_token_stops_working(client):
    token = client.headers["Authorization"]
    client.request("DELETE", "/api/account", json={"password": PASSWORD})
    assert client.get("/api/account", headers={"Authorization": token}).status_code == 401


def test_users_from_before_display_names_gain_the_column(tmp_path):
    path = tmp_path / "plink.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE users (id INTEGER NOT NULL, email VARCHAR, password_hash VARCHAR, created_at DATETIME NOT NULL, PRIMARY KEY (id))")
    con.execute("INSERT INTO users VALUES (1, 'parent@example.com', 'hash', '2026-10-03 10:00:00')")
    con.commit()
    con.close()
    eng = create_engine(f"sqlite:///{path}")
    models.init_db(eng)
    assert "display_name" in {c["name"] for c in inspect(eng).get_columns("users")}
    with Session(eng) as db:
        assert db.get(User, 1).display_name == ""
