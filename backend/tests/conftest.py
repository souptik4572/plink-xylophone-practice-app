import os

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from app import config, drill, models
from app.main import app

EMAIL = "parent@example.com"
PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def _no_gemini(monkeypatch):
    """Tests never reach Google, even with a key in .env; test_gemini fakes the API."""
    monkeypatch.setattr(config, "GEMINI_API_KEY", "")


@pytest.fixture(autouse=True)
def _no_gemma(monkeypatch, tmp_path):
    """Nor a local Ollama: unless a test fakes Gemma's replies, Gemma is down and its callers fall back."""

    def down(*args, **kwargs):
        raise httpx.ConnectError("Gemma is not reachable in tests")

    monkeypatch.setattr(httpx, "post", down)
    monkeypatch.setattr(config, "GEMMA_LOG", tmp_path / "gemma.jsonl")


@pytest.fixture
def engine():
    # TEST_DATABASE_URL runs every test against Postgres instead, e.g. postgresql+psycopg://…
    url = os.getenv("TEST_DATABASE_URL")
    if url:
        eng = create_engine(url)
        SQLModel.metadata.drop_all(eng)
    else:
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    models.init_db(eng)
    return eng


def sign_up(client: TestClient, email: str = EMAIL) -> None:
    """A new user, whose access token the client sends from then on."""
    r = client.post("/api/auth/signup", json={"email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


@pytest.fixture
def anon(engine):
    """A client that has not logged in."""

    def session():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[models.get_session] = session
    drill.clear_cache()
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def client(anon):
    sign_up(anon)
    return anon


@pytest.fixture
def user_id(client, engine):
    with Session(engine) as db:
        return db.exec(select(models.User.id).where(models.User.email == EMAIL)).one()
