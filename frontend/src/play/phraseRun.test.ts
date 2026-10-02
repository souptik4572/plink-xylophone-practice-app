import { describe, expect, it } from 'vitest'
import { createPhraseRun } from './phraseRun'

const base = {
  sessionId: 7,
  songId: 'twinkle',
  phraseIdx: 1,
  startNote: 7,
  bars: [3, 3, 2, 2],
  sessionStart: 0,
}

describe('phrase run (wait mode)', () => {
  it('waits on each note until the right bar, then advances', () => {
    const run = createPhraseRun(base)
    run.present(1000)
    expect(run.target()).toBe(3)
    expect(run.strike(5, 'keyboard', 1500)).toBe('wrong')
    expect(run.target()).toBe(3) // the target keeps glowing
    expect(run.strike(3, 'keyboard', 2000)).toBe('right')
    expect(run.position()).toBe(1)
  })

  it('completes on the last right strike and logs one row per expected note', () => {
    const run = createPhraseRun(base)
    let t = 60_000
    for (const bar of base.bars) {
      run.present(t)
      t += 700
      run.strike(bar, 'pointer', t)
    }
    expect(run.done()).toBe(true)
    const rows = run.rows()
    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual({
      session_id: 7,
      song_id: 'twinkle',
      phrase_idx: 1,
      note_idx: 7,
      target_bar: 3,
      prev_bar: null,
      pos_in_phrase: 0,
      phrase_len: 4,
      input_source: 'pointer',
      replays_before: 0,
      mins_into_session: 1,
      response_ms: 700,
      wrong_before_correct: 0,
      first_try_correct: true,
    })
    expect(rows.map((r) => r.prev_bar)).toEqual([null, 3, 3, 2])
    expect(rows.map((r) => r.note_idx)).toEqual([7, 8, 9, 10])
  })

  it('times the response from the glow to the first strike, right or wrong', () => {
    const run = createPhraseRun(base)
    run.present(1000)
    run.strike(0, 'keyboard', 1400)
    run.strike(1, 'keyboard', 1900)
    run.strike(3, 'keyboard', 2500)
    expect(run.rows()[0]).toMatchObject({ response_ms: 400, wrong_before_correct: 2, first_try_correct: false })
  })

  it('counts replays only before her first strike in the phrase', () => {
    const run = createPhraseRun(base)
    run.replayed()
    run.replayed()
    run.present(0)
    run.strike(3, 'keyboard', 300)
    run.replayed()
    run.present(400)
    run.strike(3, 'keyboard', 800)
    expect(run.rows().map((r) => r.replays_before)).toEqual([2, 2])
  })

  it('reports wrong strikes since the glow, for the spoken hint', () => {
    const run = createPhraseRun(base)
    run.present(0)
    run.strike(0, 'keyboard', 100)
    run.strike(1, 'keyboard', 200)
    expect(run.wrongSinceGlow()).toBe(2)
    run.strike(3, 'keyboard', 300)
    run.present(400)
    expect(run.wrongSinceGlow()).toBe(0)
  })

  it('keeps every strike, right and wrong, for "Play back my turn"', () => {
    const run = createPhraseRun(base)
    run.present(0)
    run.strike(1, 'keyboard', 100)
    run.strike(3, 'keyboard', 200)
    expect(run.strikes()).toEqual([
      { bar: 1, t: 100, correct: false },
      { bar: 3, t: 200, correct: true },
    ])
  })

  it('ignores strikes once the phrase is done', () => {
    const run = createPhraseRun({ ...base, bars: [0] })
    run.present(0)
    expect(run.strike(0, 'keyboard', 100)).toBe('complete')
    expect(run.strike(0, 'keyboard', 200)).toBe('ignored')
    expect(run.rows()).toHaveLength(1)
  })
})
