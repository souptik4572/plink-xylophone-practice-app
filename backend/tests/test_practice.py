"""Ending on a win, and practice from her trickiest jumps."""

import json

import pytest

from app import coach, drill
from app.jumps import practice_parts
from tests.test_api_play import row
from tests.test_drill import JumpModel
from tests.test_insights import seed


def jump_p(bars):
    """JumpModel's expected first-try success for a part: it only looks at jump sizes."""
    jumps = [0] + [abs(b - a) for a, b in zip(bars, bars[1:])]
    return sum(min(0.95, max(0.05, 0.95 - 0.12 * j)) for j in jumps) / len(jumps)


def part_rows(sid, song_id, phrase_idx, bars, first_try=True):
    return [
        row(sid, i, b, bars[i - 1] if i else None, i, first_try, song_id=song_id, phrase_idx=phrase_idx, phrase_len=len(bars))
        for i, b in enumerate(bars)
    ]


@pytest.fixture
def learned(client, engine, user_id, monkeypatch):
    """60 rows of practice, and a stand-in for TabPFN: success falls with jump size."""
    monkeypatch.setattr(drill, "tabpfn_model", JumpModel)
    seed(engine, user_id, n=60)
    return client


def twinkle(client):
    return next(s for s in client.get("/api/songs").json() if s["id"] == "twinkle")


def test_the_last_part_is_the_one_she_is_surest_of(learned):
    song = twinkle(learned)
    best = max(jump_p(song["bars"][p["start"] : p["end"] + 1]) for p in song["phrases"])
    sid = learned.post("/api/sessions", json={}).json()["id"]
    final = learned.get(f"/api/next-drill?session_id={sid}&song_id=twinkle&final=true").json()
    assert (final["reason"], final["source"]) == ("finish", "tabpfn")
    assert final["expected_success"] == pytest.approx(best)
    usual = learned.get(f"/api/next-drill?session_id={sid}&song_id=twinkle").json()
    assert usual["reason"] == "song" and usual["expected_success"] < best  # the usual pick aims at 80%


def test_before_tabpfn_knows_her_the_last_part_is_her_best_this_session(client):
    sid = client.post("/api/sessions", json={}).json()["id"]
    song = twinkle(client)
    bars = lambda k: song["bars"][song["phrases"][k]["start"] : song["phrases"][k]["end"] + 1]  # noqa: E731
    client.post("/api/attempts", json={"rows": part_rows(sid, "twinkle", 0, bars(0), first_try=False)})
    client.post("/api/attempts", json={"rows": part_rows(sid, "twinkle", 1, bars(1))})
    final = client.get(f"/api/next-drill?session_id={sid}&song_id=twinkle&final=true").json()
    assert (final["phrase_idx"], final["reason"], final["source"]) == (1, "finish", "fallback")


def test_practice_parts_work_up_to_the_jump():
    assert practice_parts(0, 4) == [("steps", [0, 2, 4, 4]), ("once", [0, 0, 4, 4]), ("twice", [0, 4, 0, 4])]
    assert practice_parts(7, 2) == [("steps", [7, 4, 2, 2]), ("once", [7, 7, 2, 2]), ("twice", [7, 2, 7, 2])]
    assert [kind for kind, _ in practice_parts(2, 3)] == ["once", "twice"]  # neighbours: no stepping stone


def practice_song(client):
    return next((s for s in client.get("/api/songs").json() if s["source"] == "drill"), None)


def test_a_session_builds_practice_from_her_weakest_jumps(learned):
    assert practice_song(learned) is None
    learned.post("/api/sessions", json={})  # the build runs as the session starts
    song = practice_song(learned)
    weak = [(w["from_bar"], w["to_bar"]) for w in learned.get("/api/progress").json()["weakest_jumps"][:2]]
    assert song["id"] == "jumps-" + "-".join(f"{a}-{b}" for a, b in weak)
    parts = [bars for a, b in weak for _, bars in practice_parts(a, b)]
    assert [song["bars"][p["start"] : p["end"] + 1] for p in song["phrases"]] == parts
    # Gemma is down in tests: the names and lines are the templates.
    assert song["phrases"][0]["nickname"] in {"Stepping stones", "One big hop"}
    assert song["phrases"][0]["tip"].endswith("!")


def test_gemma_writes_the_lines_once_and_unchanged_jumps_are_not_rebuilt(learned, monkeypatch):
    calls = []

    def fake(body, timeout):
        calls.append(body)
        count = body["messages"][-1]["content"].count(": the jump from")
        return {"message": {"content": json.dumps({"lines": [f"Hop number {k}!" for k in range(count)]})}}

    monkeypatch.setattr(coach, "_post", fake)
    learned.post("/api/sessions", json={})
    song = practice_song(learned)
    assert [p["tip"] for p in song["phrases"]][:2] == ["Hop number 0!", "Hop number 1!"]
    assert song["phrases"][0]["nickname"] in {"Stepping stones", "One big hop"}  # named by kind, not by Gemma
    prompt = calls[0]["messages"][-1]["content"]
    assert "jump from" in prompt and "English" in prompt
    learned.post("/api/sessions", json={})
    assert len(calls) == 1


def test_a_line_naming_the_wrong_colour_goes_back_to_gemma(monkeypatch):
    replies = iter([["Jump blue to orange!"], ["Jump orange to turquoise!"]])
    asked = []

    def fake(body, timeout):
        asked.append(body["messages"][-1]["content"])
        return {"message": {"content": json.dumps({"lines": next(replies)})}}

    monkeypatch.setattr(coach, "_post", fake)
    named = coach.name_jump_parts([{"kind": "once", "colours": ["orange", "orange", "turquoise", "turquoise"]}], "English")
    assert (named.source, named.parts) == ("gemma", [{"nickname": "One big hop", "tip": "Jump orange to turquoise!"}])
    assert "line 1 names blue, but that part's bars are orange, turquoise" in asked[1]


def test_a_practice_part_comes_after_every_three_song_parts(learned):
    learned.post("/api/sessions", json={})
    practice = practice_song(learned)
    sid = learned.post("/api/sessions", json={}).json()["id"]
    song = twinkle(learned)
    for k in range(3):
        nxt = learned.get(f"/api/next-drill?session_id={sid}&song_id=twinkle").json()
        assert nxt["reason"] == "song"
        p = song["phrases"][nxt["phrase_idx"]]
        learned.post("/api/attempts", json={"rows": part_rows(sid, "twinkle", nxt["phrase_idx"], song["bars"][p["start"] : p["end"] + 1])})
    nxt = learned.get(f"/api/next-drill?session_id={sid}&song_id=twinkle").json()
    assert (nxt["reason"], nxt["song_id"], nxt["source"]) == ("jumps", practice["id"], "tabpfn")
    assert nxt["song"]["phrases"] == practice["phrases"]  # the app may not have the song yet
    # TabPFN slots in the part nearest her sweet spot.
    expected = [jump_p(practice["bars"][p["start"] : p["end"] + 1]) for p in practice["phrases"]]
    assert nxt["phrase_idx"] == min(range(len(expected)), key=lambda i: abs(expected[i] - 0.8))
    # The last part of a session is still the surest, even when practice is due.
    assert learned.get(f"/api/next-drill?session_id={sid}&song_id=twinkle&final=true").json()["reason"] == "finish"
    p = practice["phrases"][nxt["phrase_idx"]]
    learned.post("/api/attempts", json={"rows": part_rows(sid, practice["id"], nxt["phrase_idx"], practice["bars"][p["start"] : p["end"] + 1])})
    assert learned.get(f"/api/next-drill?session_id={sid}&song_id=twinkle").json()["reason"] == "song"
