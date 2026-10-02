import pytest

from app import coach
from tests.test_api_play import phrase0


@pytest.fixture
def gemma(monkeypatch):
    """Canned coach replies, so these tests never call Ollama."""
    def lesson(bars, beats, labels, lyric=""):
        phrases = [{**ph, "nickname": f"Bit {i}"} for i, ph in enumerate(coach.fallback_phrases(len(bars)))]
        return coach.Lesson(phrases, "gemma", 3.2)

    monkeypatch.setattr(coach, "build_lesson", lesson)
    monkeypatch.setattr(coach, "parent_note", lambda stats, weak, name, language: coach.Note(f"{stats['notes']} notes.", "gemma", 2.0))
    monkeypatch.setattr(coach, "praise_lines", lambda name, language: coach.Praise(["Yay!"] * 10, "gemma"))


def test_lesson_is_saved_on_the_song(client, gemma):
    s = client.post("/api/songs/twinkle/lesson", json={}).json()
    assert s["lesson_source"] == "gemma" and s["lesson"] == "gemma"
    assert s["phrases"][1]["nickname"] == "Bit 1"
    assert client.get("/api/songs").json()[2]["phrases"][1]["nickname"] == "Bit 1"


def test_lesson_for_unknown_song(client, gemma):
    assert client.post("/api/songs/nope/lesson", json={}).status_code == 404


def test_parent_note_is_written_and_kept(client, gemma):
    sid = client.post("/api/sessions", json={"player": "child"}).json()["id"]
    client.post("/api/attempts", json={"rows": phrase0(sid)})
    note = client.post(f"/api/sessions/{sid}/parent-note").json()
    assert note["note"] == "4 notes." and note["source"] == "gemma"
    assert note["stats"]["first_try_pct"] == 75
    assert client.get("/api/sessions").json()[0]["parent_note"] == "4 notes."


def test_parent_note_needs_a_played_session(client, gemma):
    sid = client.post("/api/sessions", json={}).json()["id"]
    assert client.post(f"/api/sessions/{sid}/parent-note").status_code == 409


def test_praise(client, gemma):
    assert client.post("/api/praise").json() == {"lines": ["Yay!"] * 10, "source": "gemma"}


def test_delete_all_data(client, gemma):
    sid = client.post("/api/sessions", json={}).json()["id"]
    client.post("/api/attempts", json={"rows": phrase0(sid)})
    client.post("/api/songs", json={"title": "Mine", "notes": "C4 D4 E4"})
    client.post("/api/songs/twinkle/lesson", json={})
    client.put("/api/instrument", json={"bars": [{"label": "C", "colour": "#f00", "semitone_offset": 0}, {"label": "D", "colour": "#0f0", "semitone_offset": 2}]})

    assert client.delete("/api/data").json() == {"deleted": True}
    assert client.get("/api/sessions").json() == []
    assert client.get("/api/instrument").status_code == 404
    songs = client.get("/api/songs").json()
    assert [s["source"] for s in songs] == ["builtin"] * 5
    assert all(s["lesson"] == "fallback" for s in songs)
