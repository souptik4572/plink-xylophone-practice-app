"""Benchmark the drill picker's model: leave-one-session-out over her real sessions (spec 7.9).

    make eval                      # her real child sessions from plink.db
    make eval ARGS=--synthetic     # pipeline smoke test on a simulated child

Compares TabPFN with a majority-class guess, a per-jump miss-rate lookup and
logistic regression. Predictions from every held-out session are pooled,
then scored once. Report the table as printed, ties included.
"""

import argparse
import sys
import time

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sqlmodel import Session, select

from app import config  # loads .env before tabpfn is imported
from app.features import FEATURES, LABEL, frame
from app.models import Attempt, engine

NUMERIC = [f for f in FEATURES if f != "input_source"]


def majority(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    return np.full(len(test), train[LABEL].mean())


def jump_lookup(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    """Her past success rate at each jump size, smoothed; unseen sizes get her overall rate."""
    rate = train.groupby("abs_jump")[LABEL].agg(lambda s: (s.sum() + 1) / (len(s) + 2))
    return test["abs_jump"].map(rate).fillna(train[LABEL].mean()).to_numpy()


def logistic(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    prep = ColumnTransformer(
        [
            ("src", OneHotEncoder(handle_unknown="ignore"), ["input_source"]),
            ("num", make_pipeline(SimpleImputer(strategy="constant", fill_value=-1, add_indicator=True), StandardScaler()), NUMERIC),
        ]
    )
    m = make_pipeline(prep, LogisticRegression(max_iter=1000)).fit(train[FEATURES], train[LABEL].astype(int))
    return m.predict_proba(test[FEATURES])[:, 1]


def tabpfn(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    from tabpfn import TabPFNClassifier

    m = TabPFNClassifier().fit(train[FEATURES], train[LABEL].astype(int))
    return m.predict_proba(test[FEATURES])[:, list(m.classes_).index(1)]


MODELS = {
    "Majority class": majority,
    "Per-jump miss rate": jump_lookup,
    "Logistic regression": logistic,
    "TabPFN": tabpfn,
}


def load_real() -> pd.DataFrame:
    with Session(engine) as db:
        rows = db.exec(select(Attempt).where(Attempt.player == "child")).all()
    if not rows:
        return pd.DataFrame(columns=[*FEATURES, LABEL, "session_id"])
    df = frame([r.model_dump(include={*FEATURES, LABEL}) for r in rows])
    df["session_id"] = [r.session_id for r in rows]
    return df


def evaluate(df: pd.DataFrame) -> tuple[str, dict[str, float]]:
    sessions = sorted(df["session_id"].unique())
    preds = {name: np.empty(len(df)) for name in MODELS}
    seconds = dict.fromkeys(MODELS, 0.0)
    for s in sessions:
        test = df["session_id"] == s
        train = df[~test]
        for name, fn in MODELS.items():
            t = time.perf_counter()
            preds[name][test.to_numpy()] = fn(train, df[test]) if train[LABEL].nunique() > 1 else train[LABEL].mean()
            seconds[name] += time.perf_counter() - t

    y = df[LABEL].astype(int).to_numpy()
    lines = ["| Model | Accuracy | ROC AUC | Log loss | Fit + predict (s) |", "| :--- | ---: | ---: | ---: | ---: |"]
    for name, p in preds.items():
        p = np.clip(p, 1e-6, 1 - 1e-6)
        auc = roc_auc_score(y, p) if len(set(y)) > 1 else float("nan")
        lines.append(
            f"| {name} | {accuracy_score(y, p >= 0.5):.3f} | {auc:.3f} | {log_loss(y, p, labels=[0, 1]):.3f} | {seconds[name]:.1f} |"
        )
    return "\n".join(lines), seconds


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--synthetic", action="store_true", help="use a simulated child instead of plink.db")
    ap.add_argument("--sessions", type=int, default=12, help="simulated sessions (with --synthetic)")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    if args.synthetic:
        from eval.simulate import simulate

        df = simulate(args.sessions, args.seed)
        source = f"**SIMULATED child** (seed {args.seed}): a pipeline check, not her data"
    else:
        df = load_real()
        source = f"her real sessions from `{config.DB_PATH.name}`"

    n_sessions = df["session_id"].nunique()
    if n_sessions < 2:
        print(f"Need at least 2 child sessions for leave-one-session-out; found {n_sessions} ({len(df)} rows).")
        print("Play a few sessions first, or run `make eval ARGS=--synthetic` to check the pipeline.")
        return 0

    table, _ = evaluate(df)
    print(f"Drill-picker benchmark: leave-one-session-out, {n_sessions} sessions, {len(df)} rows, "
          f"{df[LABEL].mean():.0%} first-try correct.")
    print(f"Data: {source}.\n")
    print(table)
    print("\nMajority class predicts one constant per held-out session, so its pooled ROC AUC is not meaningful.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
