"""Gemma on the Gemini API: Ollama-format requests in, generateContent out, and back."""

import base64
import json

import httpx
import pytest

from app import ask, coach, config, gemini
from app.gemini import from_gemini, to_gemini

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 16).decode()
JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\0" * 16).decode()


def reply(*parts, prompt=12, out=5):
    return {"candidates": [{"content": {"role": "model", "parts": list(parts)}}], "usageMetadata": {"promptTokenCount": prompt, "candidatesTokenCount": out}}


@pytest.fixture
def api(monkeypatch, tmp_path):
    """GEMINI_API_KEY set, and the API replaced by queued replies (or an error status)."""
    monkeypatch.setattr(config, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(config, "GEMMA_MODEL", "gemma-4-26b-a4b-it")
    monkeypatch.setattr(config, "GEMMA_LOG", tmp_path / "g.jsonl")
    sent, queue = [], []

    def post(url, headers, json, timeout):
        sent.append({"url": url, "headers": headers, "body": json})
        status, body = queue.pop(0) if isinstance(queue[0], tuple) else (200, queue.pop(0))
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(gemini.httpx, "post", post)
    return sent, queue


def test_a_structured_call_with_an_image():
    body = {
        "model": "gemma-4-26b-a4b-it",
        "stream": False,
        "think": True,
        "format": {"type": "object", "properties": {"rows": {"type": "array", "items": {"type": "integer"}}}},
        "options": {"temperature": 0},
        "messages": [{"role": "system", "content": "Answer in JSON."}, {"role": "user", "content": "Count the notes.", "images": [PNG, JPEG]}],
    }
    out = to_gemini(body)
    assert out["systemInstruction"] == {"parts": [{"text": "Answer in JSON."}]}
    assert out["contents"] == [
        {
            "role": "user",
            "parts": [
                {"text": "Count the notes."},
                {"inlineData": {"mimeType": "image/png", "data": PNG}},
                {"inlineData": {"mimeType": "image/jpeg", "data": JPEG}},
            ],
        }
    ]
    assert out["generationConfig"] == {
        "temperature": 0,
        "thinkingConfig": {"thinkingLevel": "high"},
        "responseMimeType": "application/json",
        "responseJsonSchema": body["format"],
    }
    assert "tools" not in out
    assert to_gemini({**body, "think": False})["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "minimal"}


def test_a_reply_keeps_text_and_calls_but_not_thoughts():
    r = from_gemini(reply({"text": "planning…", "thought": True}, {"text": '{"lines": '}, {"text": "[]}"}, {"functionCall": {"name": "get_progress"}}))
    assert r["message"]["content"] == '{"lines": []}'
    assert r["message"]["tool_calls"] == [{"function": {"name": "get_progress", "arguments": {}}}]
    assert (r["prompt_eval_count"], r["eval_count"]) == (12, 5)
    # Nothing came back (blocked, or empty): an empty answer, which the callers already handle.
    assert from_gemini({"candidates": []})["message"]["content"] == ""


def test_tools_and_their_answers_translate_both_ways():
    model_parts = [
        {"functionCall": {"name": "predict_song", "args": {"song": "Mary"}, "id": "c1"}, "thoughtSignature": "sig"},
        {"functionCall": {"name": "get_progress", "args": {}, "id": "c2"}},
    ]
    body = {
        "model": "m",
        "tools": ask.TOOLS,
        "messages": [
            {"role": "user", "content": "How is she doing?"},
            {"role": "assistant", "content": "", "tool_calls": [], "gemini_parts": model_parts},
            {"role": "tool", "tool_name": "get_progress", "content": json.dumps({"notes": 40})},
            {"role": "tool", "tool_name": "predict_song", "content": json.dumps({"song": "Mary"})},
        ],
    }
    out = to_gemini(body)
    declared = {d["name"]: d for d in out["tools"][0]["functionDeclarations"]}
    assert set(declared) == {t["function"]["name"] for t in ask.TOOLS}
    assert "parameters" not in declared["get_progress"]  # no arguments: no empty object schema
    assert declared["predict_song"]["parameters"]["required"] == ["song"]
    assert out["contents"][1] == {"role": "model", "parts": model_parts}  # thought signature and all
    assert out["contents"][2] == {
        "role": "user",
        "parts": [
            {"functionResponse": {"name": "get_progress", "response": {"notes": 40}, "id": "c2"}},
            {"functionResponse": {"name": "predict_song", "response": {"song": "Mary"}, "id": "c1"}},
        ],
    }


def test_history_written_in_ollama_format_translates_too():
    out = to_gemini(
        {
            "model": "m",
            "messages": [
                {"role": "user", "content": "Hi"},
                {"role": "assistant", "content": "Hello."},
                {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "help_advice", "arguments": {}}}]},
                {"role": "tool", "tool_name": "help_advice", "content": "[1, 2]"},
            ],
        }
    )
    assert out["contents"][1] == {"role": "model", "parts": [{"text": "Hello."}]}
    assert out["contents"][2] == {"role": "model", "parts": [{"functionCall": {"name": "help_advice", "args": {}}}]}
    assert out["contents"][3]["parts"][0]["functionResponse"] == {"name": "help_advice", "response": {"result": [1, 2]}}


def test_the_coach_calls_the_gemini_api_when_it_has_a_key(api):
    sent, queue = api
    queue.append(reply({"text": json.dumps({"lines": [f"Great {i}!" for i in range(12)]})}))
    praise = coach.praise_lines("Mira", "English")
    assert praise.source == "gemma" and len(praise.lines) == 12
    assert sent[0]["url"] == f"{config.GEMINI_URL}/models/gemma-4-26b-a4b-it:generateContent"
    assert sent[0]["headers"] == {"x-goog-api-key": "test-key"}
    assert sent[0]["body"]["generationConfig"]["responseMimeType"] == "application/json"
    logged = json.loads(config.GEMMA_LOG.read_text().splitlines()[-1])
    assert (logged["ok"], logged["prompt_tokens"], logged["eval_tokens"]) == (True, 12, 5)


def test_a_refused_request_falls_back_and_logs_why(api):
    _, queue = api
    queue.append((400, {"error": {"message": "JSON mode is not enabled for this model"}}))
    praise = coach.praise_lines("", "English")
    assert praise.source == "fallback"
    assert "JSON mode is not enabled" in json.loads(config.GEMMA_LOG.read_text().splitlines()[-1])["error"]


def test_ask_plink_round_trip_on_the_gemini_api(api, client):
    sent, queue = api
    queue += [
        reply({"functionCall": {"name": "get_progress", "args": {}, "id": "call-1"}, "thoughtSignature": "sig-1"}),
        reply({"text": "She has played no notes yet."}),
    ]
    body = client.post("/api/ask", json={"question": "How is she doing?"}).json()
    assert body["answer"] == "She has played no notes yet."
    assert body["tools"] == [{"name": "get_progress", "args": {}, "ok": True}]
    second = sent[1]["body"]["contents"]
    assert second[-2] == {"role": "model", "parts": [{"functionCall": {"name": "get_progress", "args": {}, "id": "call-1"}, "thoughtSignature": "sig-1"}]}
    answer = second[-1]["parts"][0]["functionResponse"]
    assert (answer["name"], answer["id"], answer["response"]["notes"]) == ("get_progress", "call-1", 0)


def test_busy_or_failing_api_is_tried_again(api, monkeypatch):
    sent, queue = api
    monkeypatch.setattr(gemini.time, "sleep", lambda s: None)
    queue += [(503, {"error": {"message": "high demand"}}), (500, {"error": {"message": "Internal error"}}), reply({"text": '{"note": "x"}'})]
    assert coach._post({"model": "m", "messages": [{"role": "user", "content": "hi"}]}, 5)["message"]["content"] == '{"note": "x"}'
    assert len(sent) == 3
    queue += [(429, {"error": {"message": "quota"}})]  # a quota is not waited out
    with pytest.raises(httpx.HTTPStatusError):
        coach._post({"model": "m", "messages": [{"role": "user", "content": "hi"}]}, 5)
    assert len(sent) == 4


def test_a_stray_fence_after_the_json_is_dropped(api):
    _, queue = api
    queue.append(reply({"text": '{"lines": ["Yay!"]}\n```'}))
    body = {"model": "m", "format": {"type": "object"}, "messages": [{"role": "user", "content": "praise"}]}
    assert coach._post(body, 5)["message"]["content"] == '{"lines": ["Yay!"]}'


def test_health_does_not_call_the_api_on_every_probe(anon, api):
    sent, _ = api
    assert anon.get("/api/health").json()["gemma"] is True
    assert sent == []
