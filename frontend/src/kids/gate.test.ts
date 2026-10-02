import { describe, expect, it } from 'vitest'
import { gateQuestion } from './gate'

function seq(...xs: number[]) {
  let i = 0
  return () => xs[i++ % xs.length]
}

describe('grown-ups gate', () => {
  it('asks a two-digit sum with the answer among four distinct choices', () => {
    for (let k = 0; k < 200; k++) {
      const q = gateQuestion(Math.random)
      expect(q.a + q.b).toBe(q.answer)
      expect(q.answer).toBeGreaterThanOrEqual(10)
      expect(q.choices).toContain(q.answer)
      expect(new Set(q.choices).size).toBe(4)
      expect(q.choices.every((c) => c > 0)).toBe(true)
    }
  })

  it('is deterministic for a given random source', () => {
    expect(gateQuestion(seq(0.5, 0.25, 0.75, 0.1))).toEqual(gateQuestion(seq(0.5, 0.25, 0.75, 0.1)))
  })
})
