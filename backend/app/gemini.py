"""Gemma on Google's Gemini API, for the Render demo. The coach speaks Ollama's chat
format everywhere; this translates a request to generateContent and the reply back.
"""

import base64
import json
import time

import httpx

from app import config


def _mime(image_b64: str) -> str:
    head = base64.b64decode(image_b64[:16])
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def _declaration(tool: dict) -> dict:
    f = tool["function"]
    out = {"name": f["name"], "description": f.get("description", "")}
    # The API refuses an object schema with no properties, so a tool without arguments sends none.
    if f.get("parameters", {}).get("properties"):
        out["parameters"] = f["parameters"]
    return out


def to_gemini(body: dict) -> dict:
    system, contents, open_calls = [], [], []
    for m in body["messages"]:
        if m["role"] == "system":
            system.append({"text": m["content"]})
        elif m["role"] == "assistant":
            # The API's own parts when this turn came from it: they carry its thought signatures.
            parts = m.get("gemini_parts") or [
                *([{"text": m["content"]}] if m.get("content") or not m.get("tool_calls") else []),
                *({"functionCall": {"name": c["function"]["name"], "args": c["function"].get("arguments") or {}}} for c in m.get("tool_calls") or []),
            ]
            open_calls = [p["functionCall"] for p in parts if "functionCall" in p]
            contents.append({"role": "model", "parts": parts})
        elif m["role"] == "tool":
            result = json.loads(m["content"])
            answer = {"name": m["tool_name"], "response": result if isinstance(result, dict) else {"result": result}}
            call = next((c for c in open_calls if c["name"] == m["tool_name"]), None)
            if call:
                open_calls.remove(call)
                if call.get("id"):
                    answer["id"] = call["id"]
            # All the answers to one turn's calls go back together, in one turn.
            if contents and contents[-1]["role"] == "user" and "functionResponse" in contents[-1]["parts"][0]:
                contents[-1]["parts"].append({"functionResponse": answer})
            else:
                contents.append({"role": "user", "parts": [{"functionResponse": answer}]})
        else:
            images = [{"inlineData": {"mimeType": _mime(i), "data": i}} for i in m.get("images") or []]
            contents.append({"role": "user", "parts": [{"text": m["content"]}, *images]})

    generation: dict = {}
    if "temperature" in body.get("options", {}):
        generation["temperature"] = body["options"]["temperature"]
    if "think" in body:
        generation["thinkingConfig"] = {"thinkingLevel": "high" if body["think"] else "minimal"}
    if body.get("format"):
        generation["responseMimeType"] = "application/json"
        generation["responseJsonSchema"] = body["format"]

    out: dict = {"contents": contents, "generationConfig": generation}
    if system:
        out["systemInstruction"] = {"parts": system}
    if body.get("tools"):
        out["tools"] = [{"functionDeclarations": [_declaration(t) for t in body["tools"]]}]
    return out


def from_gemini(reply: dict) -> dict:
    parts = ((reply.get("candidates") or [{}])[0].get("content") or {}).get("parts", [])
    usage = reply.get("usageMetadata", {})
    return {
        "message": {
            "role": "assistant",
            "content": "".join(p.get("text", "") for p in parts if not p.get("thought")),
            "tool_calls": [
                {"function": {"name": p["functionCall"]["name"], "arguments": p["functionCall"].get("args") or {}}}
                for p in parts
                if "functionCall" in p
            ],
            "gemini_parts": parts,
        },
        "prompt_eval_count": usage.get("promptTokenCount"),
        "eval_count": usage.get("candidatesTokenCount"),
    }


def first_json(text: str) -> str:
    """The first JSON object in a reply. Gemma here follows the schema loosely: tested on
    lessons, 2 of 8 replies were valid JSON followed by a stray markdown fence."""
    start = text.find("{")
    try:
        return text[start : json.JSONDecoder().raw_decode(text, start)[1]] if start >= 0 else text
    except ValueError:
        return text


def chat(body: dict, timeout: float) -> dict:
    # The API answers 500 ("Internal error") or 503 ("high demand") now and then; in testing,
    # 4 of 10 lesson calls to gemma-4-31b-it. Both are worth a second try a moment later.
    for wait in (1, 3, None):
        r = httpx.post(
            f"{config.GEMINI_URL}/models/{body['model']}:generateContent",
            headers={"x-goog-api-key": config.GEMINI_API_KEY},
            json=to_gemini(body),
            timeout=timeout,
        )
        if r.status_code not in (500, 503) or wait is None:
            break
        time.sleep(wait)
    if r.is_error:
        # The body says why (a refused feature, a bad key, quota), and it ends up in the Gemma log.
        raise httpx.HTTPStatusError(f"{r.status_code} from the Gemini API: {r.text[:300]}", request=r.request, response=r)
    out = from_gemini(r.json())
    if body.get("format"):
        out["message"]["content"] = first_json(out["message"]["content"])
    return out
