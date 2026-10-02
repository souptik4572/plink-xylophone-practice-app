BARS = [
    {"label": "C", "colour": "#e5383b", "semitone_offset": 0, "template": [0.6, 0.8]},
    {"label": "D", "colour": "#f77f00", "semitone_offset": 2, "template": [0.8, 0.6]},
]


def test_instrument_is_missing_until_calibrated(client):
    assert client.get("/api/instrument").status_code == 404


def test_instrument_round_trips_with_templates(client):
    assert client.put("/api/instrument", json={"bars": BARS, "noise_floor": 0.003}).status_code == 200
    body = client.get("/api/instrument").json()
    assert body["bars"] == BARS
    assert body["noise_floor"] == 0.003


def test_recalibrating_replaces_the_instrument(client):
    client.put("/api/instrument", json={"bars": BARS})
    client.put("/api/instrument", json={"bars": [{**b, "template": None} for b in BARS]})
    assert client.get("/api/instrument").json()["bars"][0].get("template") is None


def test_bars_must_run_low_to_high(client):
    assert client.put("/api/instrument", json={"bars": BARS[::-1]}).status_code == 422
