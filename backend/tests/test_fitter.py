import json

import pytest

from app import config
from app.fitter import fit_song, note_to_midi, parse_notes

EIGHT = [0, 2, 4, 5, 7, 9, 11, 12]
BUILTIN = {s["id"]: s for s in json.loads(config.BUILTIN_SONGS.read_text())}


def midis(song_id):
    return [m for m, _ in parse_notes(BUILTIN[song_id]["notes"])]


def test_note_names():
    assert [note_to_midi(n) for n in ["C4", "A4", "C5", "F#4", "Bb4"]] == [60, 69, 72, 66, 70]
    with pytest.raises(ValueError):
        note_to_midi("H4")


def test_parse_skips_phrase_marks_and_reads_beats():
    assert parse_notes("E4 D4 C4:2 / C4:0.5") == [(64, 1.0), (62, 1.0), (60, 2.0), (60, 0.5)]


@pytest.mark.parametrize("song_id", ["hot-cross-buns", "mary", "twinkle", "jingle-bells"])
def test_four_builtin_tunes_fit_eight_bars(song_id):
    fit = fit_song(midis(song_id), EIGHT)
    assert fit.fit_score == 1.0
    assert fit.misfits == []
    assert fit.transposition == 0


def test_twinkle_lands_on_the_expected_bars():
    assert fit_song(midis("twinkle"), EIGHT).bars[:7] == [0, 0, 4, 4, 5, 5, 4]


def test_happy_birthday_almost_fits_with_two_misfits():
    notes = midis("happy-birthday")
    fit = fit_song(notes, EIGHT)
    f5 = [i for i, m in enumerate(notes) if m == note_to_midi("F5")]
    assert fit.misfits == f5 and len(f5) == 2
    assert fit.fit_score == pytest.approx(23 / 25)
    # G4 goes on the lowest bar; the missing B-flat is played on the nearest bar.
    assert fit.bars[0] == 0
    assert all(EIGHT[fit.bars[i]] in (9, 11) for i in f5)


def test_happy_birthday_fits_twelve_bars():
    chromatic = list(range(13))
    assert fit_song(midis("happy-birthday"), chromatic).fit_score == 1.0


def test_a_transposed_tune_is_moved_back_onto_the_bars():
    in_d = [m + 2 for m in midis("twinkle")]
    fit = fit_song(in_d, EIGHT)
    assert fit.fit_score == 1.0
    assert fit.transposition == -2
    assert fit.bars == fit_song(midis("twinkle"), EIGHT).bars


def test_notes_above_the_top_bar_are_misfits_on_the_top_bar():
    fit = fit_song([60, 62, 76], EIGHT)  # E5 is beyond C5
    assert fit.misfits == [2]
    assert fit.bars[2] == 7


def test_empty_song():
    assert fit_song([], EIGHT).fit_score == 1.0
