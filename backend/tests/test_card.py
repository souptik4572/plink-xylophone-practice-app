import pytest

from app import coach
from app.coach import map_card

BARS = [
    {"label": "C", "colour_name": "red"},
    {"label": "D", "colour_name": "orange"},
    {"label": "E", "colour_name": "yellow"},
    {"label": "F", "colour_name": "green"},
    {"label": "G", "colour_name": "turquoise"},
    {"label": "A", "colour_name": "blue"},
    {"label": "B", "colour_name": "purple"},
    {"label": "C′", "colour_name": "pink"},
]


def n(printed, colour):
    return {"printed": printed, "colour": colour}


def test_numbers_letters_and_colours_all_map_to_bars():
    assert map_card([n("1", "red"), n("5", "turquoise"), n("8", "pink")], BARS)["bars"] == [0, 4, 7]
    assert map_card([n("C", "red"), n("g", "turquoise"), n("A", "blue")], BARS)["bars"] == [0, 4, 5]
    assert map_card([n("", "red"), n("", "teal"), n("", "violet")], BARS)["bars"] == [0, 4, 6]


def test_colour_tells_low_c_from_high_c():
    assert map_card([n("C", "red"), n("C", "pink"), n("C'", "pink")], BARS)["bars"] == [0, 7, 7]


def test_symbol_and_colour_disagreeing_is_flagged_for_the_grown_up():
    out = map_card([n("5", "turquoise"), n("5", "red")], BARS)
    assert out["bars"] == [4, 4]  # the printed symbol wins
    assert out["flagged"] == [1]


def test_unreadable_notes_are_dropped_and_counted():
    out = map_card([n("C", "red"), n("?", "silver"), n("D", "orange")], BARS)
    assert out["bars"] == [0, 1]
    assert out["unreadable"] == 1


def test_read_card_counts_then_lists(monkeypatch, tmp_path):
    monkeypatch.setattr(coach.config, "GEMMA_LOG", tmp_path / "g.jsonl")
    replies = [
        {"message": {"content": '{"title": "Twinkle", "rows": [2, 1]}'}},
        {"message": {"content": '{"rows": [[{"printed": "1", "colour": "red"}, {"printed": "5", "colour": "turquoise"}], [{"printed": "6", "colour": "blue"}]]}'}},
    ]
    calls = []

    def fake(body, timeout):
        calls.append(body)
        return replies.pop(0)

    monkeypatch.setattr(coach, "_post", fake)
    card = coach.read_card(b"\x89PNG fake", BARS)
    assert card.title == "Twinkle" and card.counts == [2, 1]
    assert [x["printed"] for x in card.notes] == ["1", "5", "6"]
    assert calls[0]["think"] is True and calls[1]["think"] is False  # count carefully, then list fast
    assert "row 1 has exactly 2" in calls[1]["messages"][-1]["content"]
    assert calls[0]["messages"][-1]["images"]


def test_read_card_gives_up_cleanly_when_gemma_fails(monkeypatch, tmp_path):
    import httpx

    monkeypatch.setattr(coach.config, "GEMMA_LOG", tmp_path / "g.jsonl")
    monkeypatch.setattr(coach, "_post", lambda body, timeout: (_ for _ in ()).throw(httpx.ReadTimeout("slow")))
    with pytest.raises(coach.CardError):
        coach.read_card(b"img", BARS)


def test_read_card_endpoint(client, monkeypatch):
    monkeypatch.setattr(
        coach, "read_card", lambda image, bars: coach.Card("Twinkle", [n("1", "red"), n("5", "teal"), n("5", "red")], [3], 21.5)
    )
    body = client.post("/api/songs/read-card", json={"image": "data:image/jpeg;base64,aGVsbG8="}).json()
    assert body == {"title": "Twinkle", "bars": [0, 4, 4], "beats": [1, 1, 1], "flagged": [2], "unreadable": 0, "counts": [3], "seconds": 21.5}


def test_read_card_rejects_non_images(client):
    assert client.post("/api/songs/read-card", json={"image": "not base64!"}).status_code == 422
