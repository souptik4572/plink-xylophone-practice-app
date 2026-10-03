import json

import pytest

from app import ask, coach


def tool_call(name, **args):
    return {"message": {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": name, "arguments": args}}]}}


def final(text):
    return {"message": {"role": "assistant", "content": text}, "prompt_eval_count": 50, "eval_count": 20}


@pytest.fixture
def gemma(monkeypatch, tmp_path):
    monkeypatch.setattr(coach.config, "GEMMA_LOG", tmp_path / "g.jsonl")
    calls, queue = [], []

    def fake(body, timeout):
        calls.append(json.loads(json.dumps(body)))
        return queue.pop(0)

    monkeypatch.setattr(coach, "_post", fake)
    return calls, queue


def test_find_song_by_loose_title(engine, user_id):
    from sqlmodel import Session

    with Session(engine) as db:
        assert ask.find_song(db, user_id, "jingle bells").id == "jingle-bells"
        assert ask.find_song(db, user_id, "Twinkle").id == "twinkle"
        assert ask.find_song(db, user_id, "mary-had") .id == "mary"
        assert ask.find_song(db, user_id, "Bohemian Rhapsody") is None


def test_answers_by_calling_tabpfn_through_a_tool(client, gemma, monkeypatch):
    calls, queue = gemma
    monkeypatch.setattr(
        ask.drill,
        "insights",
        lambda db, user_id: {
            "source": "tabpfn",
            "rows_used": 40,
            "known_levels": ["some"],
            "songs": [{"song_id": "jingle-bells", "by_level": {"lots": 0.9, "some": 0.87, "little": 0.86}, "help": {"suggest": "try", "level": "little", "now": 0.87, "then": None}}],
            "help": None,
        },
    )
    queue += [tool_call("predict_song", song="Jingle Bells"), final("Yes: TabPFN expects 87% right first time.")]
    body = client.post("/api/ask", json={"question": "Is she ready for Jingle Bells?"}).json()
    assert body["answer"] == "Yes: TabPFN expects 87% right first time."
    assert body["tools"] == [{"name": "predict_song", "args": {"song": "Jingle Bells"}, "ok": True}]
    sent = calls[1]["messages"][-1]
    assert sent["role"] == "tool" and sent["tool_name"] == "predict_song"
    result = json.loads(sent["content"])
    assert result["song"] == "Jingle Bells (chorus)"
    # A level she has never played is reported as unknown, not as a number.
    assert result["first_try_by_help_level"] == {"lots": None, "some": 0.87, "little": None}
    assert calls[0]["tools"] and calls[0]["think"] is False


def test_unknown_tool_and_bad_song_go_back_to_gemma_as_errors(client, gemma):
    calls, queue = gemma
    queue += [tool_call("delete_everything"), tool_call("predict_song", song="Nope"), final("I couldn't find that song.")]
    body = client.post("/api/ask", json={"question": "?"}).json()
    assert [t["ok"] for t in body["tools"]] == [False, False]
    assert "error" in json.loads(calls[1]["messages"][-1]["content"])


def test_stops_after_a_few_tool_rounds(client, gemma):
    _, queue = gemma
    queue += [tool_call("get_progress")] * ask.MAX_ROUNDS
    body = client.post("/api/ask", json={"question": "loop forever"}).json()
    assert len(body["tools"]) == ask.MAX_ROUNDS
    assert "couldn't" in body["answer"].lower()


def test_history_is_kept_short(client, gemma):
    calls, queue = gemma
    queue.append(final("Hello."))
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(12)]
    client.post("/api/ask", json={"question": "hi", "history": history})
    roles = [m["role"] for m in calls[0]["messages"]]
    assert roles[0] == "system" and roles[-1] == "user"
    assert len(roles) == 1 + ask.MAX_HISTORY + 1


def test_gemma_unavailable_is_a_friendly_answer(client, gemma, monkeypatch):
    import httpx

    monkeypatch.setattr(coach, "_post", lambda body, timeout: (_ for _ in ()).throw(httpx.ConnectError("down")))
    body = client.post("/api/ask", json={"question": "How is she doing?"}).json()
    assert "Gemma" in body["answer"] and body["tools"] == []


def test_question_length_is_limited(client):
    assert client.post("/api/ask", json={"question": "x" * 501}).status_code == 422


def test_list_songs_ranks_in_code_so_gemma_only_explains(engine, user_id, monkeypatch):
    from sqlmodel import Session

    level = {"twinkle": 0.85, "jingle-bells": 0.87, "mary": 0.83, "hot-cross-buns": 0.74, "happy-birthday": 0.78}
    monkeypatch.setattr(
        ask.drill,
        "insights",
        lambda db, user_id: {"source": "tabpfn", "songs": [{"song_id": k, "by_level": {"lots": v, "some": v, "little": v}} for k, v in level.items()]},
    )
    with Session(engine) as db:
        out = ask.tool_list_songs(db, user_id)
    preds = [s["first_try_prediction"] for s in out["songs"]]
    assert preds == sorted(preds, reverse=True)  # easiest first
    assert out["songs"][0]["title"] == "Jingle Bells (chorus)"
    # Closest to her 80% sweet spot, like the Home page's pick.
    assert out["suggested_next"]["title"] == "Happy Birthday"
