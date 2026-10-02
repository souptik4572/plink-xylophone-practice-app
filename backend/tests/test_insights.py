import numpy as np
import pytest
from sqlmodel import Session

from app import drill
from app.drill import advise
from app.models import Attempt, PracticeSession
from tests.test_drill import history

LEVEL_P = {"lots": 0.97, "some": 0.85, "little": 0.82}


class LevelModel:
    """Success depends only on the help level: enough to test the advice end to end."""

    def __init__(self, table=LEVEL_P):
        self.table = table

    def fit(self, X, y):
        self.classes_ = np.array([0, 1])
        return self

    def predict_proba(self, X):
        p = X["help_level"].map(self.table).to_numpy()
        return np.column_stack([1 - p, p])


def test_advise_less_help_when_she_would_still_meet_the_target():
    a = advise({"lots": 0.97, "some": 0.85, "little": 0.82}, current="some", target=0.8)
    assert (a["suggest"], a["level"]) == ("less", "little")


def test_advise_stay_when_less_help_would_drop_below_target():
    a = advise({"lots": 0.97, "some": 0.85, "little": 0.62}, current="some", target=0.8)
    assert (a["suggest"], a["level"]) == ("stay", "some")


def test_advise_more_help_when_she_is_struggling():
    a = advise({"lots": 0.93, "some": 0.52, "little": 0.4}, current="some", target=0.8)
    assert (a["suggest"], a["level"]) == ("more", "lots")


def test_advise_at_the_ends_of_the_ladder():
    assert advise({"lots": 0.99, "some": 0.95, "little": 0.94}, current="little", target=0.8)["suggest"] == "stay"
    assert advise({"lots": 0.3, "some": 0.2, "little": 0.1}, current="lots", target=0.8)["suggest"] == "stay"


def seed(engine, n=40, levels=("some",)):
    rows = history(n).to_dict("records")
    for i, r in enumerate(rows):
        r["help_level"] = levels[i % len(levels)]
    with Session(engine) as db:
        db.add(PracticeSession(id=1, player="child"))
        db.commit()
        for i, r in enumerate(rows):
            prev = None if r["prev_bar"] is None or r["prev_bar"] != r["prev_bar"] else int(r["prev_bar"])
            db.add(
                Attempt(
                    **{k: r[k] for k in ["input_source", "target_bar", "jump", "abs_jump", "pos_in_phrase", "phrase_len",
                                         "times_seen_phrase", "replays_before", "mins_into_session", "help_level"]},
                    is_repeat=bool(r["is_repeat"]), prev_bar=prev, first_try_correct=bool(r["first_try_correct"]),
                    player="child", session_id=1, song_id="twinkle", phrase_idx=0, note_idx=i, response_ms=900,
                    wrong_before_correct=0,
                )
            )
        db.commit()


def test_insights_cold_start(client):
    body = client.get("/api/insights").json()
    assert body["source"] == "fallback" and body["songs"] == [] and body["help"] is None


def test_insights_score_every_song_at_every_level(client, engine, monkeypatch):
    monkeypatch.setattr(drill, "tabpfn_model", LevelModel)
    seed(engine, n=60, levels=("lots", "some", "little"))
    body = client.get("/api/insights").json()
    assert body["source"] == "tabpfn" and body["rows_used"] == 60
    songs = {s["song_id"]: s for s in body["songs"]}
    assert set(songs) >= {"twinkle", "mary", "hot-cross-buns", "jingle-bells", "happy-birthday"}
    assert songs["twinkle"]["by_level"] == pytest.approx(LEVEL_P)
    assert songs["mary"]["help"]["suggest"] == "less"
    assert body["help"]["suggest"] == "less" and body["help"]["level"] == "little"
    assert body["help"]["basis_song"] == "twinkle"  # the song she has practised most


def test_never_claims_she_is_ready_for_a_level_it_has_no_data_for():
    # All her rows are at "some": "little" looks equally good only because it is unseen.
    a = advise({"lots": 0.85, "some": 0.85, "little": 0.85}, current="some", target=0.8, known={"some"})
    assert (a["suggest"], a["level"]) == ("try", "little")


def test_unknown_lower_level_while_struggling_is_not_a_try():
    a = advise({"lots": 0.5, "some": 0.5, "little": 0.5}, current="some", target=0.8, known={"some"})
    assert (a["suggest"], a["level"]) == ("more", "lots")


def test_insights_report_rows_per_level_and_ask_to_try_unseen_levels(client, engine, monkeypatch):
    monkeypatch.setattr(drill, "tabpfn_model", lambda: LevelModel({"lots": 0.9, "some": 0.9, "little": 0.9}))
    seed(engine)  # every seeded row is at "some"
    body = client.get("/api/insights").json()
    assert body["rows_by_level"] == {"lots": 0, "some": 40, "little": 0}
    assert body["help"]["suggest"] == "try"
