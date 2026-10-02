
def test_health_reports_model_status(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert {"ollama", "gemma_model", "tabpfn"} <= body.keys()
