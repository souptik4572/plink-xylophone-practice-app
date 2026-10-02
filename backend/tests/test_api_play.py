def row(session_id, note_idx, target, prev, pos, first_try=True, **kw):
    return {
        "session_id": session_id,
        "song_id": "twinkle",
        "phrase_idx": 0,
        "note_idx": note_idx,
        "target_bar": target,
        "prev_bar": prev,
        "pos_in_phrase": pos,
        "phrase_len": 4,
        "input_source": "keyboard",
        "replays_before": 0,
        "mins_into_session": 0.5,
        "response_ms": 900,
        "wrong_before_correct": 0 if first_try else 1,
        "first_try_correct": first_try,
        **kw,
    }


def phrase0(sid):
    return [row(sid, 0, 0, None, 0), row(sid, 1, 0, 0, 1), row(sid, 2, 4, 0, 2, False), row(sid, 3, 4, 4, 3)]


def test_songs_list_builtins_fitted_with_phrases(client):
    songs = {s["id"]: s for s in client.get("/api/songs").json()}
    assert list(songs)[:5] == ["hot-cross-buns", "mary", "twinkle", "jingle-bells", "happy-birthday"]
    assert songs["twinkle"]["fit_score"] == 1.0
    assert songs["twinkle"]["lesson"] == "fallback"
    assert songs["twinkle"]["phrases"][0] == {"start": 0, "end": 3, "nickname": "Phrase 1", "tip": ""}
    assert len(songs["happy-birthday"]["misfits"]) == 2


def test_fit_endpoint_and_bad_notes(client):
    assert client.post("/api/songs/fit", json={"notes": "D4 F#4 A4"}).json()["transposition"] == -2
    assert client.post("/api/songs/fit", json={"notes": "H4"}).status_code == 422


def test_create_song_from_played_bars(client):
    s = client.post("/api/songs", json={"title": "Her tune", "source": "played", "bars": [0, 2, 4, 7], "beats": [1, 1, 0.5, 2]}).json()
    assert s["notes"] == "C4:1 E4:1 G4:0.5 C5:2"
    assert s["bars"] == [0, 2, 4, 7]
    assert s["id"] in {x["id"] for x in client.get("/api/songs").json()}


def test_attempt_rows_get_derived_columns_and_play_counts(client, engine):
    from sqlmodel import Session, select

    from app.models import Attempt

    sid = client.post("/api/sessions", json={"player": "child"}).json()["id"]
    assert client.post("/api/attempts", json={"rows": phrase0(sid)}).json() == {"inserted": 4}
    assert client.post("/api/attempts", json={"rows": phrase0(sid)}).status_code == 200
    with Session(engine) as db:
        rows = db.exec(select(Attempt).order_by(Attempt.id)).all()
    assert [r.jump for r in rows[:4]] == [0, 0, 4, 0]
    assert [r.is_repeat for r in rows[:4]] == [False, True, False, True]
    assert {r.times_seen_phrase for r in rows[:4]} == {0}
    assert {r.times_seen_phrase for r in rows[4:]} == {1}
    assert rows[0].player == "child"


def test_tester_sessions_are_marked(client, engine):
    from sqlmodel import Session, select

    from app.models import Attempt

    sid = client.post("/api/sessions", json={"player": "tester"}).json()["id"]
    client.post("/api/attempts", json={"rows": phrase0(sid)})
    with Session(engine) as db:
        assert {r.player for r in db.exec(select(Attempt)).all()} == {"tester"}


def test_attempts_for_unknown_session_are_rejected(client):
    assert client.post("/api/attempts", json={"rows": phrase0(999)}).status_code == 404


def test_next_drill_cold_start_walks_the_song_in_order(client):
    sid = client.post("/api/sessions", json={}).json()["id"]
    first = client.get(f"/api/next-drill?session_id={sid}&song_id=twinkle").json()
    assert first == {"song_id": "twinkle", "phrase_idx": 0, "source": "fallback", "expected_success": None}
    client.post("/api/attempts", json={"rows": phrase0(sid)})
    assert client.get(f"/api/next-drill?session_id={sid}&song_id=twinkle").json()["phrase_idx"] == 1
