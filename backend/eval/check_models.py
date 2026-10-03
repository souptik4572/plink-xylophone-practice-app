"""Smoke check: Gemma answers (Ollama, or the Gemini API with GEMINI_API_KEY) in text and JSON, and TabPFN predicts on a toy table."""

import time

import numpy as np
import pandas as pd

from app import coach, config  # loads .env first: tabpfn reads TABPFN_* settings at import

from tabpfn import TabPFNClassifier  # noqa: E402

where = "the Gemini API" if config.GEMINI_API_KEY else "Ollama"
t = time.time()
r = coach._post(
    {
        "model": config.GEMMA_MODEL,
        "stream": False,
        "think": False,  # as every call in the app sets it
        "messages": [{"role": "user", "content": "Say hello to a child learning xylophone, in six words."}],
    },
    120,
)
print(f"Gemma ({config.GEMMA_MODEL} on {where}, {time.time() - t:.1f}s): {r['message']['content'].strip()}")
# Lessons, notes, praise and song cards all ask for JSON that matches a schema.
praise = coach.praise_lines("", "English")
print(f"Gemma JSON ({praise.seconds:.1f}s): {praise.source}, {len(praise.lines)} lines {praise.error}".rstrip())

rng = np.random.default_rng(0)
X = pd.DataFrame({"abs_jump": rng.integers(0, 8, 80), "mins": rng.uniform(0, 5, 80)})
y = (X.abs_jump < 4).astype(int)
t = time.time()
proba = TabPFNClassifier().fit(X, y).predict_proba(pd.DataFrame({"abs_jump": [0, 7], "mins": [1.0, 1.0]}))
print(f"TabPFN ({time.time() - t:.1f}s): P(success | jump 0) = {proba[0, 1]:.2f}, P(success | jump 7) = {proba[1, 1]:.2f}")
