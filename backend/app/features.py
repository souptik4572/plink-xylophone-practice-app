"""Attempt rows -> TabPFN feature frame (spec 7.8, 7.9)."""

import pandas as pd

# Every attempt column except player, ids, response_ms, wrong_before_correct and the label (spec 7.9).
FEATURES = [
    "input_source",
    "target_bar",
    "prev_bar",
    "jump",
    "abs_jump",
    "is_repeat",
    "pos_in_phrase",
    "phrase_len",
    "times_seen_phrase",
    "replays_before",
    "mins_into_session",
]
LABEL = "first_try_correct"


def derive_columns(target_bar: int, prev_bar: int | None) -> dict:
    """The jump columns, computed server-side so every row is consistent."""
    if prev_bar is None:
        return {"jump": 0, "abs_jump": 0, "is_repeat": False}
    return {"jump": target_bar - prev_bar, "abs_jump": abs(target_bar - prev_bar), "is_repeat": target_bar == prev_bar}


def frame(rows: list[dict]) -> pd.DataFrame:
    """Raw rows to a DataFrame TabPFN can take as is: prev_bar is numeric with NaN at phrase starts."""
    df = pd.DataFrame(rows, columns=[*FEATURES, LABEL] if not rows or LABEL in rows[0] else FEATURES)
    df["prev_bar"] = df["prev_bar"].astype(float)
    return df


def candidate_rows(bars: list[int], times_seen: int, input_source: str, mins_into_session: float) -> pd.DataFrame:
    """A phrase's rows as if she played it next, for predict_proba."""
    rows = []
    for pos, target in enumerate(bars):
        prev = bars[pos - 1] if pos else None
        rows.append(
            {
                "input_source": input_source,
                "target_bar": target,
                "prev_bar": prev,
                **derive_columns(target, prev),
                "pos_in_phrase": pos,
                "phrase_len": len(bars),
                "times_seen_phrase": times_seen,
                "replays_before": 0,
                "mins_into_session": mins_into_session,
            }
        )
    return frame(rows)


def session_stats(rows: list[dict]) -> dict:
    """What happened in one session, for the parent note."""
    n = len(rows)
    return {
        "phrases": sum(r["pos_in_phrase"] == 0 for r in rows),
        "notes": n,
        "first_try_pct": round(100 * sum(bool(r["first_try_correct"]) for r in rows) / n) if n else 0,
        "replays": sum(r["replays_before"] for r in rows if r["pos_in_phrase"] == 0),
        "minutes": max((r["mins_into_session"] for r in rows), default=0.0),
        "avg_response_ms": round(sum(r["response_ms"] for r in rows) / n) if n else 0,
    }
