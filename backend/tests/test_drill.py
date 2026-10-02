import numpy as np
import pandas as pd
import pytest

from app import config
from app.drill import Candidate, choose, pick
from app.features import FEATURES, candidate_rows

EIGHT = 8


class JumpModel:
    """Stand-in for TabPFN: success falls with jump size. Keeps unit tests fast and offline."""

    def fit(self, X, y):
        assert list(X.columns) == FEATURES
        self.classes_ = np.array([0, 1])
        return self

    def predict_proba(self, X):
        p = np.clip(0.95 - 0.12 * X["abs_jump"].to_numpy(), 0.05, 0.95)
        return np.column_stack([1 - p, p])


def history(n, both_classes=True):
    rng = np.random.default_rng(1)
    rows = []
    for i in range(n):
        prev = int(rng.integers(0, EIGHT)) if i % 4 else None
        target = int(rng.integers(0, EIGHT))
        rows.append(
            {
                "input_source": "keyboard",
                "target_bar": target,
                "prev_bar": prev,
                "jump": 0 if prev is None else target - prev,
                "abs_jump": 0 if prev is None else abs(target - prev),
                "is_repeat": prev == target,
                "pos_in_phrase": i % 4,
                "phrase_len": 4,
                "times_seen_phrase": i // 20,
                "replays_before": 0,
                "mins_into_session": (i % 40) / 10,
                "first_try_correct": bool(i % 3) if both_classes else True,
            }
        )
    return pd.DataFrame(rows)


def cands(*phrases):
    ctx = {"input_source": "keyboard", "mins_into_session": 1.0}
    return [
        Candidate("song", i, candidate_rows(bars, times_seen=0, **ctx)) for i, bars in enumerate(phrases)
    ]


SMOOTH = [0, 1, 2, 3]  # steps of 1 -> p = 0.83
JUMPY = [0, 7, 0, 7]  # jumps of 7 -> p ~ 0.11..0.95 avg
REPEAT = [4, 4, 4, 4]  # no jumps -> p = 0.95


def test_candidate_rows_look_like_attempt_rows():
    rows = candidate_rows([2, 5, 5], times_seen=3, input_source="mic", mins_into_session=2.5)
    assert list(rows.columns) == FEATURES
    assert rows["prev_bar"].isna().tolist() == [True, False, False]
    assert rows["jump"].tolist() == [0, 3, 0]
    assert rows["is_repeat"].tolist() == [False, False, True]
    assert rows["pos_in_phrase"].tolist() == [0, 1, 2]
    assert set(rows["phrase_len"]) == {3} and set(rows["times_seen_phrase"]) == {3}


def test_cold_start_under_60_rows_walks_song_order():
    p = pick(history(config.COLD_START_MIN_ROWS - 1), cands(SMOOTH, JUMPY, REPEAT), last=("song", 0), model=JumpModel)
    assert (p.phrase_idx, p.source, p.expected_success) == (1, "fallback", None)


def test_cold_start_with_one_class_only():
    p = pick(history(200, both_classes=False), cands(SMOOTH, JUMPY, REPEAT), last=None, model=JumpModel)
    assert (p.phrase_idx, p.source) == (0, "fallback")


def test_picks_the_phrase_closest_to_the_target_success():
    p = pick(history(200), cands(JUMPY, SMOOTH, REPEAT), last=None, model=JumpModel)
    assert p.source == "tabpfn"
    assert p.phrase_idx == 1  # SMOOTH averages 0.83 + 0.95 at the start: closest to 0.80
    assert p.expected_success == pytest.approx((0.95 + 0.83 * 3) / 4)


def test_never_repeats_the_phrase_just_played():
    p = pick(history(200), cands(JUMPY, SMOOTH, REPEAT), last=("song", 1), model=JumpModel)
    assert p.phrase_idx != 1


def test_choose_handles_a_single_phrase():
    assert choose([0.5], exclude=0) == 0


def test_choose_breaks_ties_in_song_order():
    assert choose([0.7, 0.9, 0.7], exclude=None, target=0.8) == 0


from app.drill import weakest_jumps  # noqa: E402
from app.features import session_stats  # noqa: E402

LABELS = ["C", "D", "E", "F", "G", "A", "B", "C′"]


def test_weakest_jumps_from_the_model_are_the_biggest_here():
    weak = weakest_jumps(history(200), LABELS, k=2, model=JumpModel)
    assert len(weak) == 2
    assert all(w["source"] == "tabpfn" for w in weak)
    assert weak[0]["expected"] <= weak[1]["expected"]
    assert {(w["from"], w["to"]) for w in weak} <= {("C", "C′"), ("C′", "C")}


def test_weakest_jumps_at_cold_start_use_observed_miss_rates():
    rows = []
    for ok in [False, False, True]:
        rows.append({**history(1).iloc[0].to_dict(), "prev_bar": 0.0, "target_bar": 4, "first_try_correct": ok})
    for ok in [True, True, True]:
        rows.append({**history(1).iloc[0].to_dict(), "prev_bar": 1.0, "target_bar": 2, "first_try_correct": ok})
    weak = weakest_jumps(pd.DataFrame(rows), LABELS, k=1, model=JumpModel)
    assert weak == [{"from": "C", "to": "G", "expected": pytest.approx(2 / 5), "source": "observed"}]


def test_no_jumps_yet():
    assert weakest_jumps(history(0), LABELS, model=JumpModel) == []


def test_session_stats():
    rows = history(8).to_dict("records")
    for i, r in enumerate(rows):
        r["response_ms"] = 1000 + i * 100
        r["replays_before"] = 1 if r["pos_in_phrase"] == 0 else 0
    stats = session_stats(rows)
    assert stats["phrases"] == 2 and stats["notes"] == 8
    assert stats["replays"] == 2
    assert stats["first_try_pct"] == round(100 * sum(r["first_try_correct"] for r in rows) / 8)
    assert stats["avg_response_ms"] == 1350
