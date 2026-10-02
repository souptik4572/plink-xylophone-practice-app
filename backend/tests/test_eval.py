"""The benchmark's baselines must handle every feature type, including text columns."""

import numpy as np

from eval.eval_drill_picker import jump_lookup, logistic, majority
from eval.simulate import simulate


def test_baselines_predict_probabilities_on_all_feature_types():
    df = simulate(n_sessions=3, seed=2)
    df["help_level"] = np.where(df.index % 3 == 0, "lots", "some")
    test = df["session_id"] == 2
    for fn in (majority, jump_lookup, logistic):
        p = fn(df[~test], df[test])
        assert len(p) == test.sum()
        assert ((p >= 0) & (p <= 1)).all()
