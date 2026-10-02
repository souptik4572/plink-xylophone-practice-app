import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine
from sqlmodel.pool import StaticPool

from app import drill, models
from app.main import app, seed_builtin_songs


@pytest.fixture
def engine():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    models.init_db(eng)
    with Session(eng) as db:
        seed_builtin_songs(db)
    return eng


@pytest.fixture
def client(engine):
    def session():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[models.get_session] = session
    drill.clear_cache()
    yield TestClient(app)
    app.dependency_overrides.clear()
