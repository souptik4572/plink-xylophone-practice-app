from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_model_status():
    body = TestClient(app).get("/api/health").json()
    assert body["ok"] is True
    assert {"ollama", "gemma_model", "tabpfn"} <= body.keys()
