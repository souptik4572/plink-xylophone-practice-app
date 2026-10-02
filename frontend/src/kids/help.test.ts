import { describe, expect, it } from 'vitest'
import { adviceText } from './help'

describe('adviceText', () => {
  it('says each kind of advice plainly, with the numbers behind it', () => {
    expect(adviceText({ suggest: 'less', level: 'little', now: 0.9, then: 0.82 })).toBe(
      'Ready for 🌳 Little help: TabPFN expects 82% right first time with less help.',
    )
    expect(adviceText({ suggest: 'try', level: 'little', now: 0.85, then: null })).toMatch(/Try 🌳 Little help once, so TabPFN can learn/)
    expect(adviceText({ suggest: 'more', level: 'lots', now: 0.52, then: 0.9 })).toMatch(/🌱 Lots of help would make this easier: .* 52%/)
    expect(adviceText({ suggest: 'stay', level: 'some', now: 0.78, then: null })).toBe(
      '🌿 Some help is right for now: TabPFN expects 78% right first time.',
    )
  })
})
