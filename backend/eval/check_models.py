"""Milestone 0 smoke check: Gemma answers via Ollama, TabPFN predicts on a toy table."""

import time

import httpx
import numpy as np
import pandas as pd

from app import config  # loads .env first: tabpfn reads TABPFN_* settings at import

from tabpfn import TabPFNClassifier  # noqa: E402

t = time.time()
r = httpx.post(
    f"{config.OLLAMA_URL}/api/chat",
    json={
        "model": config.GEMMA_MODEL,
        "stream": False,
        "messages": [{"role": "user", "content": "Say hello to a child learning xylophone, in six words."}],
    },
    timeout=120,
)
r.raise_for_status()
print(f"Gemma ({config.GEMMA_MODEL}, {time.time() - t:.1f}s): {r.json()['message']['content'].strip()}")

rng = np.random.default_rng(0)
X = pd.DataFrame({"abs_jump": rng.integers(0, 8, 80), "mins": rng.uniform(0, 5, 80)})
y = (X.abs_jump < 4).astype(int)
t = time.time()
proba = TabPFNClassifier().fit(X, y).predict_proba(pd.DataFrame({"abs_jump": [0, 7], "mins": [1.0, 1.0]}))
print(f"TabPFN ({time.time() - t:.1f}s): P(success | jump 0) = {proba[0, 1]:.2f}, P(success | jump 7) = {proba[1, 1]:.2f}")
