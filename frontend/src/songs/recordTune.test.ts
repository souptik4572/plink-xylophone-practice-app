import { describe, expect, it } from 'vitest'
import { DEFAULT_INSTRUMENT } from '../instrument'
import { lettersToTune, snapToBeats } from './recordTune'

const at = (bars: number[], times: number[]) => bars.map((bar, i) => ({ bar, t: times[i] }))

describe('snapToBeats', () => {
  it('takes the typical gap between strikes as one beat', () => {
    const tune = snapToBeats(at([0, 0, 4, 4, 5, 5, 4], [0, 600, 1200, 1800, 2400, 3000, 3600]))
    expect(tune.bars).toEqual([0, 0, 4, 4, 5, 5, 4])
    expect(tune.beats).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(tune.msPerBeat).toBe(600)
  })

  it('snaps uneven playing to the nearest half beat', () => {
    // Hot Cross Buns as a parent might play it: long notes held, quick ones rushed.
    const tune = snapToBeats(at([2, 1, 0, 2, 1, 0, 0, 0], [0, 520, 1000, 2050, 2600, 3080, 4100, 4380]))
    expect(tune.beats).toEqual([1, 1, 2, 1, 1, 2, 0.5, 1])
  })

  it('never makes a note shorter than half a beat or longer than four', () => {
    const tune = snapToBeats(at([0, 1, 2, 3, 4], [0, 500, 1000, 1080, 6000]))
    expect(tune.beats.slice(0, 4)).toEqual([1, 1, 0.5, 4])
  })

  it('gives the last note one beat', () => {
    expect(snapToBeats(at([0, 1, 2], [0, 700, 1400])).beats.at(-1)).toBe(1)
  })

  it('handles one or two strikes', () => {
    expect(snapToBeats(at([3], [0]))).toEqual({ bars: [3], beats: [1], msPerBeat: 0 })
    expect(snapToBeats(at([3, 4], [0, 800])).beats).toEqual([1, 1])
  })

  it('ignores strikes too close together to be separate notes', () => {
    const tune = snapToBeats(at([0, 0, 1, 2], [0, 40, 600, 1200]))
    expect(tune.bars).toEqual([0, 1, 2])
  })
})

describe('lettersToTune', () => {
  it('reads letters as bars, with lengths and the high C', () => {
    expect(lettersToTune("c C g:2 C'", DEFAULT_INSTRUMENT)).toEqual({ bars: [0, 0, 4, 7], beats: [1, 1, 2, 1] })
    expect(lettersToTune('C′, D', DEFAULT_INSTRUMENT)).toEqual({ bars: [7, 1], beats: [1, 1] })
  })

  it('explains what is wrong instead of guessing', () => {
    expect(lettersToTune('C H', DEFAULT_INSTRUMENT)).toMatch(/"H" is not one of her bars/)
    expect(lettersToTune('C:9', DEFAULT_INSTRUMENT)).toMatch(/length/)
    expect(lettersToTune('  ', DEFAULT_INSTRUMENT)).toBe('Type at least one note')
  })
})
