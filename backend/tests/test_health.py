
def test_health_reports_model_status(anon):
    # No login: Render's health check calls this.
    body = anon.get("/api/health").json()
    assert body["ok"] is True
    assert {"gemma", "gemma_model", "tabpfn"} <= body.keys()
