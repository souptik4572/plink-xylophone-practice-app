"""A simulated child's attempt log, for smoke-testing the benchmark before real sessions exist.

Never report these numbers as hers. The hidden rule is invented: big jumps
(especially downward ones) are harder, repeats are easy, practice helps, and
she tires after a few minutes.
"""

import json

import numpy as np
import pandas as pd

from app import config
from app.coach import fallback_phrases
from app.features import candidate_rows
from app.fitter import fit_song, parse_notes

SOURCE_EFFECT = {"keyboard": 0.3, "pointer": 0.0, "mic": -0.4}


def simulate(n_sessions: int = 12, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    songs = json.loads(config.BUILTIN_SONGS.read_text())[:4]
    library = []
    for s in songs:
        bars = fit_song([m for m, _ in parse_notes(s["notes"])], config.DEFAULT_OFFSETS).bars
        library.append((s["id"], [(p["start"], bars[p["start"] : p["end"] + 1]) for p in fallback_phrases(len(bars))]))

    seen: dict[tuple[str, int], int] = {}
    out = []
    for session in range(n_sessions):
        ability = rng.normal(0, 0.4)
        source = rng.choice(["keyboard", "pointer", "mic"], p=[0.5, 0.35, 0.15])
        song_id, phrases = library[rng.integers(len(library))]
        mins, idx = 0.0, 0
        while mins < config.SESSION_MINUTES:
            start, bars = phrases[idx % len(phrases)]
            key = (song_id, idx % len(phrases))
            rows = candidate_rows(bars, seen.get(key, 0), str(source), mins)
            rows["replays_before"] = int(rng.random() < 0.2)
            for _, r in rows.iterrows():
                r["mins_into_session"] = round(mins, 3)
                logit = (
                    1.6
                    + ability
                    - 0.45 * r["abs_jump"]
                    - 0.3 * (r["jump"] < -2)
                    + 0.6 * r["is_repeat"]
                    + 0.35 * np.log1p(r["times_seen_phrase"])
                    - 0.35 * max(0.0, mins - 3)
                    + 0.25 * (r["pos_in_phrase"] == 0)
                    + 0.2 * r["replays_before"]
                    + SOURCE_EFFECT[r["input_source"]]
                )
                ok = rng.random() < 1 / (1 + np.exp(-logit))
                secs = rng.uniform(2.5, 6.0) * (1 if ok else 2)
                out.append(
                    {
                        **r.to_dict(),
                        "first_try_correct": bool(ok),
                        "session_id": session,
                        "song_id": song_id,
                        "phrase_idx": key[1],
                        "note_idx": start + r["pos_in_phrase"],
                        "response_ms": round(secs * 1000),
                        "wrong_before_correct": int(not ok),
                    }
                )
                mins += secs / 60
            seen[key] = seen.get(key, 0) + 1
            idx += 1
    df = pd.DataFrame(out)
    df["prev_bar"] = df["prev_bar"].astype(float)
    return df
