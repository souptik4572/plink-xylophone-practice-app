"""Practice from her trickiest jumps. TabPFN finds the jumps, code builds short parts
that work on each (easiest first), Gemma writes what Plink says before each one, and the
drill picker slots one in at her sweet spot every few song parts.
"""

import logging

from sqlalchemy.engine import Engine
from sqlmodel import Session, col, delete

from app import coach, config, drill, summary
from app.fitter import REFERENCE_MIDI, midi_to_name
from app.models import Song, bar_labels, bar_legend, bar_offsets, get_settings

log = logging.getLogger("plink.jumps")


def practice_parts(a: int, b: int) -> list[tuple[str, list[int]]]:
    """Parts for the jump from bar a to bar b, easiest first: via a stepping stone
    (a big jump only), once playing each bar twice, then there and back twice."""
    parts = [("steps", [a, (a + b) // 2, b, b])] if abs(b - a) >= 2 else []
    return [*parts, ("once", [a, a, b, b]), ("twice", [a, b, a, b])]


def refresh(engine: Engine, user_id: int) -> None:
    """Rebuilds her "Tricky jumps" song when her weakest jumps change. Runs as a session
    starts, off her path; the drill picker uses it from the fourth part on."""
    try:
        with Session(engine) as db:
            weak = drill.weakest_jumps(summary.child_history(db, user_id), bar_labels(db, user_id), k=config.JUMP_DRILLS)
            jumps = [(w["from_bar"], w["to_bar"]) for w in weak]
            if not jumps:
                return
            song_id = "jumps-" + "-".join(f"{a}-{b}" for a, b in jumps)
            if db.get(Song, (user_id, song_id)):
                return
            parts = [part for a, b in jumps for part in practice_parts(a, b)]
            legend = bar_legend(db, user_id)
            colours = [[legend[i]["colour_name"] or legend[i]["label"] for i in bars] for _, bars in parts]
            named = coach.name_jump_parts([{"kind": kind, "colours": c} for (kind, _), c in zip(parts, colours)], get_settings(db, user_id).home_language)
            offsets = bar_offsets(db, user_id)
            notes: list[str] = []
            phrases = []
            for (_, bars), name in zip(parts, named.parts):
                phrases.append({"start": len(notes), "end": len(notes) + len(bars) - 1, **name})
                # Each part ends on a long note, so it sounds finished.
                notes += [f"{midi_to_name(REFERENCE_MIDI + offsets[b])}:{2 if i == len(bars) - 1 else 1}" for i, b in enumerate(bars)]
            db.exec(delete(Song).where(col(Song.user_id) == user_id, col(Song.source) == "drill"))
            db.add(Song(user_id=user_id, id=song_id, title="Tricky jumps", notes=" ".join(notes), source="drill", phrases=phrases))
            db.commit()
            log.info("Jump practice %s built (%s names) for user %d", song_id, named.source, user_id)
    except Exception:
        log.exception("Building her jump practice failed")
