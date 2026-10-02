"""Places a song on her bars: tries every transposition that puts the lowest note on a bar (spec 7.6)."""

import re
from dataclasses import dataclass

STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# Songs are written in the reference key of C, where C4 sits on the lowest bar.
REFERENCE_MIDI = 60
NOTE_RE = re.compile(r"^([A-G])([#b]?)(-?\d)$")


def note_to_midi(name: str) -> int:
    m = NOTE_RE.match(name)
    if not m:
        raise ValueError(f"Not a note name: {name}")
    accidental = {"#": 1, "b": -1}.get(m[2], 0)
    return 12 * (int(m[3]) + 1) + STEPS[m[1]] + accidental


def parse_notes(text: str) -> list[tuple[int, float]]:
    """'E4 D4 C4:2 / ...' -> [(midi, beats), ...]. '/' marks phrases for human readers only."""
    out = []
    for tok in text.split():
        if tok == "/":
            continue
        name, _, beats = tok.partition(":")
        out.append((note_to_midi(name), float(beats) if beats else 1.0))
    return out


def midi_to_name(midi: int) -> str:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return f"{names[midi % 12]}{midi // 12 - 1}"


@dataclass
class Fit:
    bars: list[int]
    misfits: list[int]
    fit_score: float
    transposition: int


def fit_song(midis: list[int], offsets: list[int]) -> Fit:
    if not midis:
        return Fit([], [], 1.0, 0)
    lowest = min(midis) - REFERENCE_MIDI
    on_bar = set(offsets)

    def hits(shift: int) -> int:
        return sum(m - REFERENCE_MIDI + shift in on_bar for m in midis)

    # Ties go to the transposition closest to the key the song was written in.
    shift = max((o - lowest for o in offsets), key=lambda s: (hits(s), -abs(s)))

    bars, misfits = [], []
    for i, m in enumerate(midis):
        rel = m - REFERENCE_MIDI + shift
        if rel in on_bar:
            bars.append(offsets.index(rel))
        else:
            bars.append(min(range(len(offsets)), key=lambda b: (abs(offsets[b] - rel), offsets[b])))
            misfits.append(i)
    return Fit(bars, misfits, (len(midis) - len(misfits)) / len(midis), shift)
