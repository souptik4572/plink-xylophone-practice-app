"""Gemma coach via Ollama: lessons, parent note, praise, with fallbacks (spec 7.10)."""

from app import config


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
