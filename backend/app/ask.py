"""Ask Plink: a grown-up's question, answered by Gemma calling tools over her
practice data and TabPFN. Gemma never sees raw rows and never invents numbers:
every fact comes back from a tool, and the tools only read.
"""

import json
import re
import time
from typing import Any

import httpx
from sqlmodel import Session, select

from app import coach, config, drill, summary
from app.fitter import parse_notes
from app.models import Song, get_settings, song_phrases

MAX_ROUNDS = 4
MAX_HISTORY = 6

SYSTEM = (
    "You are Plink's helper for the grown-up who sits beside {name} while she learns a toy xylophone. "
    "Answer in {language}, in two to four short, plain sentences. No tables, no headings. "
    "Use the tools for every fact about her; never guess a number. "
    "Percentages are TabPFN's predictions of her getting a note right first time. "
    "If a help level shows null, she has not played at that level yet, so TabPFN cannot judge it: say so. "
    "Only help with her practice, her songs and this app; for anything else, say that is all you can help with."
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_progress",
            "description": "Her totals: sessions, notes played, first-try percentage, stars, day streak, and the bar-to-bar jumps she finds hardest.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_songs",
            "description": "Every song in her library, with its number of notes and parts, and TabPFN's predicted first-try chance at her current help level.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "predict_song",
            "description": "TabPFN's prediction of her first-try success on one song at each help level (lots, some, little), with its advice.",
            "parameters": {
                "type": "object",
                "properties": {"song": {"type": "string", "description": "The song's title, or part of it"}},
                "required": ["song"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "help_advice",
            "description": "Whether she should have more help, less help, or stay at her current help level, according to TabPFN.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recent_sessions",
            "description": "Her most recent practice sessions: date, parts, notes, first-try percentage, and the note written for the grown-up.",
            "parameters": {
                "type": "object",
                "properties": {"count": {"type": "integer", "description": "How many sessions, 1 to 10"}},
            },
        },
    },
]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def find_song(db: Session, user_id: int, query: str) -> Song | None:
    """Loose title matching: Gemma says "Jingle Bells", the library has "Jingle Bells (chorus)"."""
    q = _norm(query)
    if not q:
        return None
    songs = list(db.exec(select(Song).where(Song.user_id == user_id)).all())
    for s in songs:
        if q in (_norm(s.id), _norm(s.title)):
            return s
    for s in songs:
        if q in _norm(s.title) or q in _norm(s.id):
            return s
    words = set(q.split())
    best = max(songs, key=lambda s: len(words & set(_norm(s.title).split())), default=None)
    return best if best and words & set(_norm(best.title).split()) else None


def _pct(p: float | None) -> float | None:
    return None if p is None else round(p, 2)


def tool_get_progress(db: Session, user_id: int) -> dict[str, Any]:
    p = summary.progress(db, user_id)
    p["weakest_jumps"] = [{**w, "expected": _pct(w["expected"])} for w in p["weakest_jumps"]]
    return p


def tool_list_songs(db: Session, user_id: int) -> dict[str, Any]:
    """Ranked in code, not by Gemma: a small model misreads a list of numbers
    (it called an 85% song the easiest when another was 87%)."""
    prefs = get_settings(db, user_id)
    ins = drill.insights(db, user_id)
    ready = {s["song_id"]: s["by_level"][prefs.help_level] for s in ins["songs"]} if ins["source"] == "tabpfn" else {}
    songs = [
        {
            "title": s.title,
            "notes": len(parse_notes(s.notes)),
            "parts": len(song_phrases(s)),
            "first_try_prediction": _pct(ready.get(s.id)),
        }
        for s in db.exec(select(Song).where(Song.user_id == user_id)).all()
    ]
    songs.sort(key=lambda s: -1 if s["first_try_prediction"] is None else s["first_try_prediction"], reverse=True)
    scored = [s for s in songs if s["first_try_prediction"] is not None]
    nxt = min(scored, key=lambda s: abs(s["first_try_prediction"] - prefs.drill_target), default=None)
    return {
        "current_help_level": prefs.help_level,
        "note": "songs are listed easiest first; suggested_next is the one to practise next",
        "songs": songs,
        "suggested_next": nxt and {**nxt, "why": f"closest to her sweet spot of {round(prefs.drill_target * 100)}% right first time"},
    }


def tool_predict_song(db: Session, user_id: int, song: str = "") -> dict[str, Any]:
    found = find_song(db, user_id, song)
    if found is None:
        return {"error": f"No song like '{song}' in her library. Use list_songs to see them."}
    ins = drill.insights(db, user_id)
    if ins["source"] != "tabpfn":
        return {"song": found.title, "note": f"TabPFN is still learning her ({ins['rows_used']} notes so far), so there is no prediction yet."}
    entry = next(s for s in ins["songs"] if s["song_id"] == found.id)
    known = set(ins.get("known_levels") or [])
    prefs = get_settings(db, user_id)
    return {
        "song": found.title,
        "first_try_by_help_level": {lv: (_pct(p) if lv in known else None) for lv, p in entry["by_level"].items()},
        "current_help_level": prefs.help_level,
        "her_target": prefs.drill_target,
        "advice": entry["help"],
        "learned_from_notes": ins["rows_used"],
    }


def tool_help_advice(db: Session, user_id: int) -> dict[str, Any]:
    ins = drill.insights(db, user_id)
    if ins["source"] != "tabpfn" or not ins["help"]:
        return {"note": f"TabPFN is still learning her ({ins['rows_used']} notes so far)."}
    h = ins["help"]
    basis = db.get(Song, (user_id, h["basis_song"]))
    return {
        "current_help_level": get_settings(db, user_id).help_level,
        "suggest": h["suggest"],
        "level": h["level"],
        "expected_now": _pct(h["now"]),
        "expected_at_suggested_level": _pct(h["then"]),
        "based_on_song": basis.title if basis else h["basis_song"],
        "notes_played_at_each_level": ins.get("rows_by_level"),
    }


def tool_recent_sessions(db: Session, user_id: int, count: int = 3) -> dict[str, Any]:
    count = max(1, min(10, int(count)))
    return {
        "sessions": [
            {
                "date": s["started_at"][:16],
                "grown_up_test": s["player"] == "tester",
                **{k: s["stats"][k] for k in ("phrases", "notes", "first_try_pct", "minutes")},
                "note_for_grown_up": s["parent_note"],
            }
            for s in summary.sessions(db, user_id, count)
        ]
    }


HANDLERS = {
    "get_progress": tool_get_progress,
    "list_songs": tool_list_songs,
    "predict_song": tool_predict_song,
    "help_advice": tool_help_advice,
    "recent_sessions": tool_recent_sessions,
}


def answer(db: Session, user_id: int, question: str, history: list[dict[str, str]]) -> dict[str, Any]:
    prefs = get_settings(db, user_id)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM.format(name=prefs.child_name or "a young child", language=prefs.home_language)},
        *history[-MAX_HISTORY:],
        {"role": "user", "content": question},
    ]
    used: list[dict[str, Any]] = []
    t = time.perf_counter()
    for _ in range(MAX_ROUNDS):
        body = {
            "model": config.GEMMA_MODEL,
            "stream": False,
            "think": False,
            "options": {"temperature": 0.2},
            "messages": messages,
            "tools": TOOLS,
        }
        try:
            reply = coach._post(body, config.GEMMA_TIMEOUT_S)
        except httpx.HTTPError as e:
            coach._log("ask", False, time.perf_counter() - t, None, f"{type(e).__name__}: {e}")
            hint = "Try again in a moment." if config.GEMINI_API_KEY else "Is Ollama running?"
            return {"answer": f"Gemma isn't answering right now. {hint}", "tools": used, "seconds": round(time.perf_counter() - t, 1)}
        msg = reply.get("message", {})
        calls = msg.get("tool_calls") or []
        if not calls:
            coach._log("ask", True, time.perf_counter() - t, reply)
            text = (msg.get("content") or "").strip() or "Sorry, I don't have an answer for that."
            return {"answer": text, "tools": used, "seconds": round(time.perf_counter() - t, 1)}
        # The whole reply goes back, so the Gemini API gets its own parts (and thought signatures) again.
        messages.append({**msg, "role": "assistant", "content": msg.get("content", ""), "tool_calls": calls})
        for call in calls:
            name = call.get("function", {}).get("name", "")
            args = call.get("function", {}).get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = {}
            handler = HANDLERS.get(name)
            if handler is None:
                result: dict[str, Any] = {"error": f"There is no tool called {name}."}
            else:
                try:
                    # Gemma's arguments can't name another user: a user_id among them is a TypeError.
                    result = handler(db, user_id, **args)
                except (TypeError, ValueError) as e:
                    result = {"error": f"Bad arguments for {name}: {e}"}
            used.append({"name": name, "args": args, "ok": "error" not in result})
            messages.append({"role": "tool", "tool_name": name, "content": json.dumps(result, default=str)})
    coach._log("ask", False, time.perf_counter() - t, None, "too many tool rounds")
    return {"answer": "Sorry, I couldn't work that out. Try asking it a different way.", "tools": used, "seconds": round(time.perf_counter() - t, 1)}
