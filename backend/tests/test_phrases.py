import pytest

from app.coach import fallback_phrases


@pytest.mark.parametrize("n", range(3, 60))
def test_fallback_phrases_are_contiguous_cover_every_note_and_hold_3_to_6(n):
    phrases = fallback_phrases(n)
    assert phrases[0]["start"] == 0
    assert phrases[-1]["end"] == n - 1
    for a, b in zip(phrases, phrases[1:]):
        assert b["start"] == a["end"] + 1
    assert all(3 <= p["end"] - p["start"] + 1 <= 6 for p in phrases)


def test_fallback_uses_four_note_phrases_where_it_can():
    assert [p["end"] - p["start"] + 1 for p in fallback_phrases(17)] == [4, 4, 4, 5]
    assert [p["end"] - p["start"] + 1 for p in fallback_phrases(15)] == [4, 4, 4, 3]


def test_tiny_songs_are_one_phrase():
    assert fallback_phrases(2) == [{"start": 0, "end": 1, "nickname": "Phrase 1", "tip": ""}]
