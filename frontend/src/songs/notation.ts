import type { Instrument } from '../instrument'

// Songs are written as note names with octaves in the reference key of C,
// each optionally followed by ":beats" (default 1). "/" marks a phrase break
// for people reading the file and is skipped here.
// Example: "E4 D4 C4:2 / E4 D4 C4:2"

export interface SongDef {
  id: string
  title: string
  notes: string
}

export interface SongNote {
  midi: number
  beats: number
}

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** In the reference key, C4 sits on the lowest bar. */
export const REFERENCE_MIDI = 60

export function noteToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name)
  if (!m) throw new Error(`Not a note name: ${name}`)
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return 12 * (Number(m[3]) + 1) + STEPS[m[1]] + accidental
}

export function parseNotes(text: string): SongNote[] {
  return text
    .split(/\s+/)
    .filter((tok) => tok && tok !== '/')
    .map((tok) => {
      const [name, beats] = tok.split(':')
      return { midi: noteToMidi(name), beats: beats ? Number(beats) : 1 }
    })
}

/**
 * Places a reference-key tune directly on the instrument's bars, with no
 * transposition. Returns null if any note has no bar. The backend fitter
 * (spec 7.6) handles transposition and misfits; this is enough for the
 * built-in tunes on the free-play screen.
 */
export function toDefaultBars(notes: SongNote[], instrument: Instrument): { bar: number; beats: number }[] | null {
  const placed = notes.map((n) => ({
    bar: instrument.bars.findIndex((b) => b.semitone_offset === n.midi - REFERENCE_MIDI),
    beats: n.beats,
  }))
  return placed.every((n) => n.bar >= 0) ? placed : null
}
