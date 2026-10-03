"""Gemma coach via Ollama, or the Gemini API on Render: lessons, parent note, praise, with fallbacks (spec 7.10).

Code owns the notes: Gemma only groups them and writes words. Every reply is
validated; on invalid output or a timeout the caller gets a fixed fallback.
"""

import base64
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from app import config, gemini

log = logging.getLogger("plink.coach")

DEFAULT_PRAISE = ["Well done!", "Yay!", "Brilliant!", "You did it!", "Super!", "Lovely playing!"]


def fallback_phrases(n: int) -> list[dict]:
    """Fixed four-note phrases, used until Gemma has built a lesson or when it fails."""
    size = config.FALLBACK_PHRASE_NOTES
    if n < config.PHRASE_MIN_NOTES:
        bounds = [(0, n - 1)]
    else:
        bounds = [(s, s + size - 1) for s in range(0, n - n % size, size)]
        rest = n % size
        if rest >= config.PHRASE_MIN_NOTES:
            bounds.append((n - rest, n - 1))
        elif rest:
            bounds[-1] = (bounds[-1][0], n - 1)
    return [{"start": s, "end": e, "nickname": f"Phrase {i + 1}", "tip": ""} for i, (s, e) in enumerate(bounds)]



def _post(body: dict, timeout: float) -> dict:
    if config.GEMINI_API_KEY:
        return gemini.chat(body, timeout)
    r = httpx.post(f"{config.OLLAMA_URL}/api/chat", json=body, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _log(job: str, ok: bool, seconds: float, reply: dict | None, error: str = "") -> None:
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "job": job,
        "model": config.GEMMA_MODEL,
        "ok": ok,
        "seconds": round(seconds, 2),
        # Ollama's own timing, including model load if it was cold (none from the Gemini API).
        "model_seconds": round((reply or {}).get("total_duration", 0) / 1e9, 2) or None,
        "prompt_tokens": (reply or {}).get("prompt_eval_count"),
        "eval_tokens": (reply or {}).get("eval_count"),
        "error": error,
    }
    log.info("gemma %s ok=%s %.1fs tokens=%s/%s", job, ok, seconds, entry["prompt_tokens"], entry["eval_tokens"])
    config.GEMMA_LOG.parent.mkdir(parents=True, exist_ok=True)
    with config.GEMMA_LOG.open("a") as f:
        f.write(json.dumps(entry) + "\n")


def _ask(
    job: str,
    system: str,
    prompt: str,
    schema: dict,
    validate,
    timeout: float = config.GEMMA_TIMEOUT_S,
    images: list[str] | None = None,
    think: bool | None = None,
    temperature: float = 0.3,
):
    """One structured call. Returns (validated value or None, error, seconds)."""
    user: dict = {"role": "user", "content": prompt}
    if images:
        user["images"] = images
    body = {
        "model": config.GEMMA_MODEL,
        "stream": False,
        "think": config.GEMMA_THINK if think is None else think,
        "format": schema,
        "options": {"temperature": temperature},
        "messages": [{"role": "system", "content": system}, user],
    }
    t = time.perf_counter()
    reply = None
    try:
        reply = _post(body, timeout)
        value = validate(json.loads(reply["message"]["content"]))
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
        seconds = time.perf_counter() - t
        error = f"{type(e).__name__}: {e}"
        _log(job, False, seconds, reply, error)
        return None, error, seconds
    seconds = time.perf_counter() - t
    _log(job, True, seconds, reply)
    return value, "", seconds


LESSON_SCHEMA = {
    "type": "object",
    "properties": {
        "phrases": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start": {"type": "integer"},
                    "end": {"type": "integer"},
                    "nickname": {"type": "string"},
                    "tip": {"type": "string"},
                },
                "required": ["start", "end", "nickname", "tip"],
            },
        }
    },
    "required": ["phrases"],
}


def _resize(phrases: list[dict]) -> list[dict]:
    """Gemma sometimes breaks the 3–6 rule by a note or two: split long phrases, merge short ones."""
    lo, hi = config.PHRASE_MIN_NOTES, config.PHRASE_MAX_NOTES
    size = lambda ph: ph["end"] - ph["start"] + 1  # noqa: E731
    split = []
    for ph in phrases:
        parts = -(-size(ph) // hi)  # ceiling division
        bounds = [ph["start"] + round(k * size(ph) / parts) for k in range(parts + 1)]
        for k in range(parts):
            name = ph["nickname"] if k == 0 else f"{ph['nickname']} {k + 1}"
            split.append({**ph, "start": bounds[k], "end": bounds[k + 1] - 1, "nickname": name})
    out: list[dict] = []
    for ph in split:
        if out and (size(ph) < lo or size(out[-1]) < lo) and size(ph) + size(out[-1]) <= hi:
            out[-1] = {**out[-1], "end": ph["end"]}
        else:
            out.append(ph)
    return out


def validate_lesson(obj: dict, n: int) -> list[dict]:
    """Phrases are contiguous, cover every note, and hold 3–6 notes each."""
    phrases = obj["phrases"]
    if not phrases:
        raise ValueError("no phrases")
    expect = 0
    clean = []
    for ph in phrases:
        start, end = int(ph["start"]), int(ph["end"])
        if start != expect or end < start:
            raise ValueError(f"phrase {start}-{end} does not follow on from {expect - 1}")
        nickname, tip = str(ph["nickname"]).strip(), str(ph["tip"]).strip()
        if not nickname or len(nickname) > 40 or len(tip) > 120:
            raise ValueError(f"bad nickname or tip at {start}")
        clean.append({"start": start, "end": end, "nickname": nickname, "tip": tip})
        expect = end + 1
    if expect != n:
        raise ValueError(f"phrases end at {expect - 1}, song has {n} notes")
    if n < config.PHRASE_MIN_NOTES:
        return clean
    out = _resize(clean)
    bad = [ph for ph in out if not config.PHRASE_MIN_NOTES <= ph["end"] - ph["start"] + 1 <= config.PHRASE_MAX_NOTES]
    if bad:
        raise ValueError(f"phrase {bad[0]['start']}-{bad[0]['end']} cannot be resized to 3–6 notes")
    return out


@dataclass
class Lesson:
    phrases: list[dict]
    source: str  # gemma | fallback
    seconds: float = 0.0
    error: str = ""


def build_lesson(bars: list[int], beats: list[float], labels: list[str], lyric: str = "") -> Lesson:
    n = len(bars)
    notes = ", ".join(
        f"{i}:{labels[b]}" + (f" ({beats[i]:g} beats)" if beats[i] != 1 else "") for i, b in enumerate(bars)
    )
    prompt = (
        f"Here is a melody of {n} notes for a young child on an 8-bar toy xylophone. "
        "Each note is index:bar, with its length when it is not one beat.\n"
        f"Notes: {notes}\n"
        + (f"Lyric: {lyric}\n" if lyric else "")
        + f"Split it into phrases of {config.PHRASE_MIN_NOTES} to {config.PHRASE_MAX_NOTES} notes where a singer "
        "would breathe; a long note usually ends a phrase. Phrases must be contiguous and cover every note, "
        f"from 0 to {n - 1}; 'end' is inclusive. Give each phrase a short, playful nickname a small child would "
        "enjoy (at most 4 words), and a tip for the parent sitting beside her (at most 12 words)."
    )
    system = "You are a gentle music teacher for very young children. You answer only with the requested JSON."
    phrases, error, seconds = _ask(
        "lesson", system, prompt, LESSON_SCHEMA, lambda o: validate_lesson(o, n), config.GEMMA_LESSON_TIMEOUT_S
    )
    if phrases is None:
        return Lesson(fallback_phrases(n), "fallback", seconds, error)
    return Lesson(phrases, "gemma", seconds)


NOTE_SCHEMA = {"type": "object", "properties": {"note": {"type": "string"}}, "required": ["note"]}


@dataclass
class Note:
    text: str
    source: str
    seconds: float = 0.0
    error: str = ""


def _jump(w: dict) -> str:
    return f"{w['from']} to {w['to']}"


def template_note(stats: dict, weak: list[dict], name: str) -> str:
    who = name or "Your child"
    text = (
        f"{who} played {stats['phrases']} phrases ({stats['notes']} notes) and got "
        f"{stats['first_try_pct']}% right first time."
    )
    if weak:
        text += f" Next time, practise the jump from {_jump(weak[0])}."
    return text


def _validate_note(obj: dict) -> str:
    text = " ".join(str(obj["note"]).split())
    if not 20 <= len(text) <= 600:
        raise ValueError(f"note length {len(text)}")
    return text


def parent_note(stats: dict, weak: list[dict], name: str, language: str) -> Note:
    child = name or "the child"
    if weak:
        jumps = "; ".join(f"{_jump(w)} (about {round(w['expected'] * 100)}% right first time)" for w in weak)
        focus = f"Hardest jumps between bars, from her practice model: {jumps}. Name the first as the one to practise next."
    else:
        focus = "There is not enough practice yet to say which jumps are hard, so do not mention jumps."
    prompt = (
        f"Session summary for {child}: {stats['phrases']} phrases, {stats['notes']} notes, "
        f"{stats['first_try_pct']}% right first time, {stats['replays']} times she asked to hear a phrase again, "
        f"{stats['minutes']:.0f} minutes.\n{focus}\n"
        f"Write a note to her parent in {language}: two or three plain, warm sentences, saying one thing that went "
        "well. " + ("" if name else "Call her 'your child'; never invent a name. ")
        + "No lists, no markdown, no exclamation-heavy cheerleading."
    )
    system = "You write short, kind, practical notes to parents of very young music learners."
    text, error, seconds = _ask("parent_note", system, prompt, NOTE_SCHEMA, _validate_note)
    if text is None:
        return Note(template_note(stats, weak, name), "fallback", seconds, error)
    return Note(text, "gemma", seconds)


PRAISE_SCHEMA = {
    "type": "object",
    "properties": {"lines": {"type": "array", "items": {"type": "string"}}},
    "required": ["lines"],
}


@dataclass
class Praise:
    lines: list[str]
    source: str
    seconds: float = 0.0
    error: str = ""


def _validate_praise(obj: dict) -> list[str]:
    seen, lines = set(), []
    for line in obj["lines"]:
        line = " ".join(str(line).split())
        if 1 <= len(line) <= 40 and line.lower() not in seen:
            seen.add(line.lower())
            lines.append(line)
    if len(lines) < 10:
        raise ValueError(f"only {len(lines)} usable lines")
    return lines[:20]


def praise_lines(name: str, language: str) -> Praise:
    who = f"Use her name, {name}, in a few of them." if name else "Do not use any name."
    prompt = (
        f"Write 20 different short praise lines in {language} for a young child who just played a phrase on "
        f"her xylophone. Each at most 6 words, spoken aloud by a computer voice, so no emoji. {who}"
    )
    system = "You write cheerful, simple words for very young children."
    lines, error, seconds = _ask("praise", system, prompt, PRAISE_SCHEMA, _validate_praise)
    if lines is None:
        return Praise(DEFAULT_PRAISE, "fallback", seconds, error)
    return Praise(lines, "gemma", seconds)


COLOUR_WORDS = {
    "teal": "turquoise", "cyan": "turquoise", "aqua": "turquoise", "light blue": "turquoise",
    "violet": "purple", "lilac": "purple", "lavender": "purple",
    "magenta": "pink", "rose": "pink", "fuchsia": "pink",
    "gold": "yellow", "amber": "orange", "lime": "green", "navy": "blue", "dark blue": "blue",
    "crimson": "red", "scarlet": "red",
}


def _bar_by_colour(word: str, bars: list[dict]) -> int | None:
    w = " ".join(word.lower().split())
    w = COLOUR_WORDS.get(w, w)
    names = [str(b.get("colour_name") or "").lower() for b in bars]
    return names.index(w) if w in names else None


def _bar_by_symbol(symbol: str, colour_bar: int | None, bars: list[dict]) -> int | None:
    s = symbol.strip().replace("′", "'").replace("’", "'")
    if s.isdigit():
        k = int(s)
        return k - 1 if 1 <= k <= len(bars) else None
    labels = [str(b["label"]).replace("′", "'").upper() for b in bars]
    same = [i for i, lab in enumerate(labels) if lab.rstrip("'") == s.upper().rstrip("'")]
    if not same:
        return None
    if s.endswith("'"):
        primed = [i for i in same if labels[i].endswith("'")]
        return primed[0] if primed else same[-1]
    # Two bars can share a letter (low and high C): the colour says which one.
    return colour_bar if colour_bar in same else same[0]


def map_card(notes: list[dict], bars: list[dict]) -> dict:
    """What Gemma saw on the card, to her bars. Code owns the notes.

    The printed number or letter wins; the colour is a cross-check, and a note
    where the two disagree is flagged for the grown-up. Notes with neither are
    dropped and counted.
    """
    out: list[int] = []
    flagged: list[int] = []
    unreadable = 0
    for note in notes:
        cb = _bar_by_colour(str(note.get("colour", "")), bars)
        printed = str(note.get("printed", "")).strip()
        sb = _bar_by_symbol(printed, cb, bars) if printed else None
        bar = sb if sb is not None else cb
        if bar is None:
            unreadable += 1
            continue
        if sb is not None and cb is not None and sb != cb:
            flagged.append(len(out))
        out.append(bar)
    return {"bars": out, "flagged": flagged, "unreadable": unreadable}


class CardError(Exception):
    pass


@dataclass
class Card:
    title: str
    notes: list[dict]
    counts: list[int]
    seconds: float


CARD_SYSTEM = "You read song cards for children's toy xylophones. You answer only with the requested JSON."
CARD_NOTE = {
    "type": "object",
    "properties": {"printed": {"type": "string"}, "colour": {"type": "string"}},
    "required": ["printed", "colour"],
}


def read_card(image: bytes, bars: list[dict]) -> Card:
    """Gemma 4 vision, in two passes measured on test cards: counting circles is
    where the small model slips (it dropped the last circle of each row), so it
    first counts with thinking on, then lists the notes fast with the counts given.
    """
    img = base64.b64encode(image).decode()
    legend = ", ".join(f"{i + 1} {b['label']} {b.get('colour_name') or ''}".strip() for i, b in enumerate(bars))
    intro = f"This is a song card for a child's toy xylophone (bars, low to high: {legend}). The notes are drawn as coloured shapes in rows."

    def valid_counts(o: dict) -> dict:
        rows = [int(x) for x in o["rows"]]
        if not 1 <= len(rows) <= 12 or not all(1 <= r <= 32 for r in rows):
            raise ValueError(f"odd row counts {rows}")
        return {"title": str(o.get("title", "")).strip()[:80], "rows": rows}

    counted, err, s1 = _ask(
        "card_count",
        CARD_SYSTEM,
        f"{intro} How many notes are in each row, top to bottom? Count carefully, including the last one on the right. "
        "Also give the song title if one is printed.",
        {"type": "object", "properties": {"title": {"type": "string"}, "rows": {"type": "array", "items": {"type": "integer"}}}, "required": ["title", "rows"]},
        valid_counts,
        config.GEMMA_VISION_TIMEOUT_S,
        images=[img],
        think=True,
        temperature=0,
    )
    if counted is None:
        raise CardError(err)
    counts = counted["rows"]

    def valid_rows(o: dict) -> list[dict]:
        rows = o["rows"]
        if len(rows) != len(counts):
            raise ValueError(f"{len(rows)} rows, expected {len(counts)}")
        return [{"printed": str(n["printed"]), "colour": str(n["colour"])} for row in rows for n in row]

    spec = "; ".join(f"row {i + 1} has exactly {c} notes" for i, c in enumerate(counts))
    notes, err, s2 = _ask(
        "card_read",
        CARD_SYSTEM,
        f"{intro} The rows: {spec}. List every note row by row, left to right. 'printed' is exactly the letter or number "
        "printed on it, or an empty string if there is none; never number the notes yourself. 'colour' is one plain colour word.",
        {
            "type": "object",
            "properties": {
                "rows": {
                    "type": "array",
                    "minItems": len(counts),
                    "maxItems": len(counts),
                    "items": {"type": "array", "items": CARD_NOTE},
                }
            },
            "required": ["rows"],
        },
        valid_rows,
        config.GEMMA_VISION_TIMEOUT_S,
        images=[img],
        think=False,
        temperature=0,
    )
    if notes is None:
        raise CardError(err)
    return Card(counted["title"], notes, counts, round(s1 + s2, 1))
