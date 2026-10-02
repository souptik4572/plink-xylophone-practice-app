import { describe, expect, it } from 'vitest'
import { DEFAULT_INSTRUMENT, withColourNames } from './instrument'

describe('withColourNames', () => {
  it('names the colours of an instrument saved before bars had names', () => {
    const saved = { bars: DEFAULT_INSTRUMENT.bars.map(({ colour_name: _, ...b }) => b), noise_floor: 0.01 }
    expect(withColourNames(saved).bars.map((b) => b.colour_name)).toEqual(DEFAULT_INSTRUMENT.bars.map((b) => b.colour_name))
    expect(withColourNames(saved).noise_floor).toBe(0.01)
  })

  it('keeps a name the family chose, and leaves unknown colours alone', () => {
    const inst = { bars: [{ label: 'C', colour: '#e5383b', colour_name: 'cherry', semitone_offset: 0 }, { label: 'D', colour: '#123456', semitone_offset: 2 }] }
    expect(withColourNames(inst).bars.map((b) => b.colour_name)).toEqual(['cherry', undefined])
  })
})
