import { describe, expect, it } from 'vitest'
import { DEFAULT_INSTRUMENT } from '../instrument'
import builtin from './builtin.json'
import { noteToMidi, parseNotes, toDefaultBars } from './notation'

describe('notation', () => {
  it('reads note names with octaves', () => {
    expect(noteToMidi('C4')).toBe(60)
    expect(noteToMidi('A4')).toBe(69)
    expect(noteToMidi('C5')).toBe(72)
    expect(noteToMidi('F#4')).toBe(66)
    expect(noteToMidi('Bb4')).toBe(70)
    expect(() => noteToMidi('H4')).toThrow()
  })

  it('parses beats and skips phrase markers', () => {
    expect(parseNotes('E4 D4 C4:2 / C4:0.5')).toEqual([
      { midi: 64, beats: 1 },
      { midi: 62, beats: 1 },
      { midi: 60, beats: 2 },
      { midi: 60, beats: 0.5 },
    ])
  })

  it('places reference-key tunes on the default eight bars', () => {
    expect(toDefaultBars(parseNotes('C4 D4 E4 F4 G4 A4 B4 C5'), DEFAULT_INSTRUMENT)!.map((n) => n.bar)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ])
    expect(toDefaultBars(parseNotes('C4 Bb4'), DEFAULT_INSTRUMENT)).toBeNull()
  })

  it('ships four built-in tunes that fit eight bars, and Happy Birthday that does not', () => {
    const fits = builtin.filter((s) => toDefaultBars(parseNotes(s.notes), DEFAULT_INSTRUMENT))
    expect(fits.map((s) => s.id)).toEqual(['hot-cross-buns', 'mary', 'twinkle', 'jingle-bells'])
    expect(builtin.map((s) => s.id)).toContain('happy-birthday')
  })

  it('matches the note counts in the spec table', () => {
    const count = (id: string) => parseNotes(builtin.find((s) => s.id === id)!.notes).length
    expect(count('hot-cross-buns')).toBe(17)
    expect(count('mary')).toBe(26)
    expect(count('twinkle')).toBe(42)
    expect(count('jingle-bells')).toBe(26)
    expect(count('happy-birthday')).toBe(25)
  })
})
