import { describe, expect, it } from 'vitest'
import { cleanNotes, envelope, notesToText, type Envelope, type HeardNote } from './hum'
import { midiToName } from './notation'

const n = (midi: number, startS: number, durS: number, amp = 0.5): HeardNote => ({ midi, startS, durS, amp })

describe('cleanNotes', () => {
  it('drops notes shorter than 120 ms', () => {
    expect(cleanNotes([n(60, 0, 0.5), n(62, 0.5, 0.08), n(64, 0.6, 0.4)]).map((x) => x.midi)).toEqual([60, 64])
  })

  it('keeps the loudest note at each moment', () => {
    // A quiet octave ghost under the sung note is dropped; the sung note stays whole.
    const out = cleanNotes([n(60, 0, 0.6, 0.8), n(72, 0.05, 0.5, 0.2), n(62, 0.7, 0.5, 0.7)])
    expect(out.map((x) => x.midi)).toEqual([60, 62])
    expect(out[0].durS).toBeCloseTo(0.6)
  })

  it('cuts a louder note in where a quieter one was still ringing', () => {
    const out = cleanNotes([n(60, 0, 1.0, 0.3), n(64, 0.5, 0.5, 0.9)])
    expect(out.map((x) => [x.midi, +x.startS.toFixed(2), +x.durS.toFixed(2)])).toEqual([
      [60, 0, 0.5],
      [64, 0.5, 0.5],
    ])
  })

  it('merges a note reported twice, but keeps real repeats', () => {
    const twice = cleanNotes([n(67, 0, 0.3), n(67, 0.2, 0.3)])
    expect(twice).toHaveLength(1)
    expect(twice[0].durS).toBeCloseTo(0.5)
    // Basic Pitch runs a note up to the next onset, so a sung "C C" arrives touching.
    const repeat = cleanNotes([n(60, 0.6, 0.6), n(60, 1.21, 0.55)])
    expect(repeat).toHaveLength(2)
  })

  it('sorts by start time and survives an empty take', () => {
    expect(cleanNotes([n(64, 1, 0.3), n(60, 0, 0.3)]).map((x) => x.midi)).toEqual([60, 64])
    expect(cleanNotes([])).toEqual([])
  })
})

/** A loudness envelope at 10 ms frames: loud during each [start, end), quiet elsewhere. */
function env(sounding: [number, number][], seconds = 4): Envelope {
  const frameS = 0.01
  const rms = Array.from({ length: Math.round(seconds / frameS) }, (_, i) =>
    sounding.some(([a, b]) => i * frameS >= a && i * frameS < b) ? 0.2 : 0.002,
  )
  return { frameS, rms }
}

describe('cleanNotes with the loudness envelope', () => {
  it('re-joins fragments of one held note: no dip in loudness between them', () => {
    // One long F# that Basic Pitch broke into four pieces.
    const frags = [n(66, 0.6, 0.21), n(66, 0.81, 0.16), n(66, 0.97, 0.17), n(66, 1.14, 0.2)]
    const out = cleanNotes(frags, env([[0.6, 1.34]]))
    expect(out).toHaveLength(1)
    expect(out[0].durS).toBeCloseTo(0.74)
  })

  it('keeps a sung repeat apart: the voice dips between the two', () => {
    const repeat = [n(60, 0.6, 0.6), n(60, 1.21, 0.55)]
    expect(cleanNotes(repeat, env([[0.6, 1.15], [1.22, 1.75]]))).toHaveLength(2)
  })

  it('keeps short fragments long enough to merge before the 120 ms rule drops them', () => {
    const frags = [n(64, 1.0, 0.1), n(64, 1.1, 0.1), n(64, 1.2, 0.1)]
    expect(cleanNotes(frags, env([[1.0, 1.3]])).map((x) => +x.durS.toFixed(2))).toEqual([0.3])
  })

  it('drops a note far outside the tune’s range, and a quiet ghost', () => {
    const tune = [n(57, 0.6, 0.5, 0.9), n(64, 1.2, 0.5, 0.9), n(66, 1.8, 0.5, 0.9), n(35, 2.4, 0.4, 0.36), n(52, 3.0, 0.3, 0.2)]
    expect(cleanNotes(tune).map((x) => x.midi)).toEqual([57, 64, 66])
  })
})

describe('envelope', () => {
  it('measures RMS in 10 ms frames', () => {
    const sr = 1000
    const samples = new Float32Array(100)
    samples.fill(0.5, 50)
    const e = envelope(samples, sr)
    expect(e.frameS).toBe(0.01)
    expect(e.rms).toHaveLength(10)
    expect(e.rms[0]).toBe(0)
    expect(e.rms[9]).toBeCloseTo(0.5)
  })
})

describe('notesToText', () => {
  it('writes note names with lengths snapped to half beats', () => {
    // Twinkle's opening hummed at 100 bpm: five quarters and a half note.
    const notes = [0, 0.6, 1.2, 1.8, 2.4, 3.0].map((t, i) => n([60, 60, 67, 67, 69, 69][i], t, 0.5))
    notes.push(n(67, 3.6, 1.1))
    expect(notesToText(notes)).toBe('C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2')
  })

  it('handles a single note', () => {
    expect(notesToText([n(62, 0, 0.5)])).toBe('D4:1')
  })
})

describe('midiToName', () => {
  it('names sharps and octaves', () => {
    expect([60, 61, 69, 72, 71].map(midiToName)).toEqual(['C4', 'C#4', 'A4', 'C5', 'B4'])
  })
})
