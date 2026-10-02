import json

import httpx
import pytest

from app import coach

TWINKLE_BARS = [0, 0, 4, 4, 5, 5, 4, 3, 3, 2, 2, 1, 1, 0]
TWINKLE_BEATS = [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2]
LABELS = ["C", "D", "E", "F", "G", "A", "B", "C′"]


def reply(content, seconds=1.0):
    return {
        "message": {"content": json.dumps(content) if not isinstance(content, str) else content},
        "prompt_eval_count": 100,
        "eval_count": 50,
        "total_duration": int(seconds * 1e9),
    }


@pytest.fixture
def ollama(monkeypatch, tmp_path):
    """Replace the Ollama call; records requests, returns queued replies (or raises them)."""
    calls, queue = [], []
    monkeypatch.setattr(coach.config, "GEMMA_LOG", tmp_path / "gemma.jsonl")

    def fake(body, timeout):
        calls.append(body)
        r = queue.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(coach, "_post", fake)
    return calls, queue



def p(s, e):
    return {"start": s, "end": e, "nickname": "Hop", "tip": "Go slow."}


GOOD = [p(0, 3), p(4, 6), p(7, 10), p(11, 13)]


def test_valid_lesson_passes():
    assert coach.validate_lesson({"phrases": GOOD}, 14) == GOOD


@pytest.mark.parametrize(
    "phrases, why",
    [
        ([p(0, 3), p(5, 8), p(9, 13)], "gap"),
        ([p(0, 3), p(3, 6), p(7, 10), p(11, 13)], "overlap"),
        ([p(0, 3), p(4, 6), p(7, 10), p(11, 12)], "misses the last note"),
        ([p(1, 3), p(4, 6), p(7, 10), p(11, 13)], "misses the first note"),
        ([*GOOD[:3], {**GOOD[3], "nickname": ""}], "empty nickname"),
        ([], "no phrases"),
    ],
)
def test_invalid_lessons_are_rejected(phrases, why):
    with pytest.raises(ValueError):
        coach.validate_lesson({"phrases": phrases}, 14)



def test_lesson_from_gemma_is_used_when_valid(ollama):
    calls, queue = ollama
    queue.append(reply({"phrases": GOOD}))
    lesson = coach.build_lesson(TWINKLE_BARS, TWINKLE_BEATS, LABELS)
    assert lesson.source == "gemma"
    assert lesson.phrases == GOOD
    body = calls[0]
    assert body["think"] is False and body["stream"] is False
    assert body["format"]["required"] == ["phrases"]
    prompt = body["messages"][-1]["content"]
    assert "6:G (2 beats)" in prompt  # long notes are shown: they end phrases


def test_lesson_falls_back_on_invalid_output(ollama):
    _, queue = ollama
    queue.append(reply({"phrases": [p(0, 1)]}))
    lesson = coach.build_lesson(TWINKLE_BARS, TWINKLE_BEATS, LABELS)
    assert lesson.source == "fallback"
    assert lesson.phrases == coach.fallback_phrases(14)
    assert "ValueError" in lesson.error


def test_lesson_falls_back_on_unparseable_json(ollama):
    _, queue = ollama
    queue.append(reply("not json"))
    assert coach.build_lesson(TWINKLE_BARS, TWINKLE_BEATS, LABELS).source == "fallback"


def test_lesson_falls_back_on_timeout(ollama):
    _, queue = ollama
    queue.append(httpx.ReadTimeout("slow"))
    lesson = coach.build_lesson(TWINKLE_BARS, TWINKLE_BEATS, LABELS)
    assert lesson.source == "fallback"
    assert "Timeout" in lesson.error


def test_every_call_is_logged_with_time_and_tokens(ollama):
    _, queue = ollama
    queue.append(reply({"phrases": GOOD}, seconds=2.5))
    coach.build_lesson(TWINKLE_BARS, TWINKLE_BEATS, LABELS)
    entry = json.loads(coach.config.GEMMA_LOG.read_text().splitlines()[-1])
    assert entry["job"] == "lesson" and entry["ok"] is True
    assert entry["prompt_tokens"] == 100 and entry["eval_tokens"] == 50
    assert entry["model_seconds"] == 2.5 and entry["seconds"] >= 0


STATS = {"phrases": 6, "notes": 28, "first_try_pct": 79, "replays": 3, "minutes": 5.0, "avg_response_ms": 1400}
WEAK = [{"from": "C", "to": "G", "expected": 0.41}, {"from": "A", "to": "F", "expected": 0.55}]


def test_parent_note_from_gemma(ollama):
    calls, queue = ollama
    queue.append(reply({"note": "Mira played six phrases today. Next, practise the jump from C up to G."}))
    note = coach.parent_note(STATS, WEAK, name="Mira", language="English")
    assert note.source == "gemma"
    assert note.text.startswith("Mira played")
    prompt = calls[0]["messages"][-1]["content"]
    assert "C to G" in prompt and "English" in prompt


def test_parent_note_falls_back_to_a_template(ollama):
    _, queue = ollama
    queue.append(reply({"note": ""}))
    note = coach.parent_note(STATS, WEAK, name="Mira", language="English")
    assert note.source == "fallback"
    assert "28" in note.text and "79%" in note.text and "C to G" in note.text


def test_template_without_weak_jumps_or_name():
    text = coach.template_note(STATS, [], name="")
    assert "Your child" in text and "jump" not in text



def test_praise_lines_are_cleaned(ollama):
    _, queue = ollama
    lines = [f"Great job {i}!" for i in range(20)] + ["Great job 1!", "x" * 80]
    queue.append(reply({"lines": lines}))
    praise = coach.praise_lines(name="Mira", language="English")
    assert praise.source == "gemma"
    assert len(praise.lines) == 20  # duplicate and over-long line dropped


def test_too_few_praise_lines_fall_back(ollama):
    _, queue = ollama
    queue.append(reply({"lines": ["Yay!"]}))
    assert coach.praise_lines(name="", language="English").lines == coach.DEFAULT_PRAISE


def test_oversized_phrase_is_split_keeping_gemma_names():
    out = coach.validate_lesson({"phrases": [p(0, 3), {**p(4, 13), "nickname": "Long Slide"}]}, 14)
    assert [(x["start"], x["end"]) for x in out] == [(0, 3), (4, 8), (9, 13)]
    assert [x["nickname"] for x in out] == ["Hop", "Long Slide", "Long Slide 2"]


def test_undersized_phrase_is_merged_into_its_neighbour():
    out = coach.validate_lesson({"phrases": [p(0, 3), p(4, 5), p(6, 9), p(10, 13)]}, 14)
    assert [(x["start"], x["end"]) for x in out] == [(0, 5), (6, 9), (10, 13)]


def test_undersized_first_phrase_merges_forward():
    out = coach.validate_lesson({"phrases": [p(0, 1), p(2, 5), p(6, 9), p(10, 13)]}, 14)
    assert [(x["start"], x["end"]) for x in out] == [(0, 5), (6, 9), (10, 13)]


def test_parent_note_without_a_name_or_jumps_tells_gemma_not_to_invent_them(ollama):
    calls, queue = ollama
    queue.append(reply({"note": "Your child played six phrases today with lovely focus."}))
    coach.parent_note(STATS, [], name="", language="English")
    prompt = calls[0]["messages"][-1]["content"]
    assert "never invent a name" in prompt
    assert "do not mention jumps" in prompt
