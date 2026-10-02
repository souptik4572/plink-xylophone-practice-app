"""TabPFN drill picker: fit, predict, choose, cold start (spec 7.9)."""


def next_in_song_order(phrase_count: int, last_phrase: int | None) -> int:
    """Cold start: the phrase after the last one played, wrapping to the start."""
    return 0 if last_phrase is None else (last_phrase + 1) % phrase_count
