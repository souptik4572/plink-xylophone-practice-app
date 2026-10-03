"""End to end through the real TabPFN: slower (a few seconds) and needs the licensed weights."""

import pytest
from sqlmodel import Session

from app.models import Attempt, PracticeSession
from eval.simulate import simulate

pytest.importorskip("tabpfn")


def test_next_drill_uses_tabpfn_once_she_has_enough_rows(client, engine, user_id):
    df = simulate(n_sessions=3, seed=1)
    with Session(engine) as db:
        for s in range(3):
            db.add(PracticeSession(id=s + 1, user_id=user_id, player="child"))
        db.commit()
        for i, r in df.iterrows():
            prev = None if r["prev_bar"] != r["prev_bar"] else int(r["prev_bar"])
            db.add(
                Attempt(
                    **{k: r[k] for k in ["input_source", "target_bar", "jump", "abs_jump", "pos_in_phrase", "phrase_len",
                                         "times_seen_phrase", "replays_before", "mins_into_session"]},
                    is_repeat=bool(r["is_repeat"]), prev_bar=prev, first_try_correct=bool(r["first_try_correct"]),
                    user_id=user_id, player="child", session_id=int(r["session_id"]) + 1, song_id="twinkle", phrase_idx=0,
                    note_idx=i, response_ms=900, wrong_before_correct=0,
                )
            )
        db.commit()

    pick = client.get("/api/next-drill?session_id=3&song_id=mary").json()
    assert pick["source"] == "tabpfn"
    assert 0 < pick["expected_success"] < 1
    assert pick["song_id"] == "mary"
