import { beforeEach, describe, expect, it } from 'vitest'
import { audioConfig } from '../audio/audioConfig'
import { attemptToNotes, PlaybackEngine, songToNotes, type ReplayNote } from './playback'

const { lookaheadS, startLeadS, litFraction, loopGapMs } = audioConfig.playback

// A fake audio clock and sound sink, so timing is checked without Web Audio.
let clock = 0
let sounded: { bar: number; when: number; cancelled: boolean }[] = []
let struck: number[] = []
const deps = {
  now: () => clock,
  sound: (bar: number, when: number) => {
    const s = { bar, when, cancelled: false }
    sounded.push(s)
    return () => {
      s.cancelled = true
    }
  },
  onNote: (n: ReplayNote) => struck.push(n.bar),
}
const live = () => sounded.filter((s) => !s.cancelled)

/** Advance the clock in 10 ms steps, pumping and drawing like the browser driver does. */
function run(engine: PlaybackEngine, seconds: number) {
  const end = clock + seconds
  while (clock < end - 1e-9) {
    clock = Math.round((clock + 0.01) * 1000) / 1000
    engine.pump()
    engine.frame()
  }
}

// Three quarter notes at 60 bpm: one note per second.
const threeNotes = songToNotes(
  [
    { bar: 0, beats: 1 },
    { bar: 2, beats: 1 },
    { bar: 4, beats: 2 },
  ],
  60,
)

beforeEach(() => {
  clock = 10
  sounded = []
  struck = []
})

describe('songToNotes', () => {
  it('turns beats into start times and durations', () => {
    expect(threeNotes).toEqual([
      { bar: 0, t_ms: 0, dur_ms: 1000 },
      { bar: 2, t_ms: 1000, dur_ms: 1000 },
      { bar: 4, t_ms: 2000, dur_ms: 2000 },
    ])
  })

  it('keeps misfit flags', () => {
    expect(songToNotes([{ bar: 3, beats: 1, misfit: true }], 120)[0]).toMatchObject({ misfit: true, dur_ms: 500 })
  })
})

describe('attemptToNotes', () => {
  it('replays her own timing from the first strike, wrong strikes muted', () => {
    const notes = attemptToNotes([
      { bar: 0, t: 5000, correct: true },
      { bar: 3, t: 5600, correct: false },
      { bar: 2, t: 6100, correct: true },
    ])
    expect(notes).toEqual([
      { bar: 0, t_ms: 0, dur_ms: 600, muted: false },
      { bar: 3, t_ms: 600, dur_ms: 500, muted: true },
      { bar: 2, t_ms: 1100, dur_ms: audioConfig.playback.attemptTailMs, muted: false },
    ])
  })
})

describe('PlaybackEngine', () => {
  it('schedules every note on the audio clock at its exact time', () => {
    const e = new PlaybackEngine(threeNotes, deps)
    e.play()
    run(e, 5)
    const t0 = 10 + startLeadS
    expect(live().map((s) => s.bar)).toEqual([0, 2, 4])
    live().forEach((s, i) => expect(s.when).toBeCloseTo(t0 + i, 6))
    expect(e.status).toBe('ended')
  })

  it('never schedules further ahead than the lookahead window', () => {
    const e = new PlaybackEngine(threeNotes, deps)
    e.play()
    for (let i = 0; i < 300; i++) {
      run(e, 0.01)
      for (const s of sounded) expect(s.when - clock).toBeLessThanOrEqual(lookaheadS + 0.011)
    }
  })

  it('lights each note exactly while it sounds, with the next bar cued', () => {
    const e = new PlaybackEngine(threeNotes, deps)
    e.play()
    run(e, startLeadS + 0.5) // halfway through note 0
    expect(e.frame()).toEqual({ current: 0, next: 1 })
    run(e, 1.0) // halfway through note 1
    expect(e.frame()).toEqual({ current: 1, next: 2 })
    run(e, 0.45) // past note 1's lit window, before note 2: dark, with note 2 cued
    expect(litFraction).toBeLessThan(0.95)
    expect(e.frame()).toEqual({ current: null, next: 2 })
  })

  it('emits each replayed note once, as it sounds', () => {
    const e = new PlaybackEngine(threeNotes, deps)
    e.play()
    run(e, 1.5)
    expect(struck).toEqual([0, 2])
    run(e, 3)
    expect(struck).toEqual([0, 2, 4])
  })

  it('plays at half speed with doubled gaps', () => {
    const e = new PlaybackEngine(threeNotes, deps)
    e.setTempo(0.5)
    e.play()
    run(e, 8)
    const whens = live().map((s) => s.when)
    expect(whens[1] - whens[0]).toBeCloseTo(2, 6)
    expect(whens[2] - whens[1]).toBeCloseTo(2, 6)
  })

  it('pauses without sounding queued notes and resumes from the same spot', () => {
    const e = new PlaybackEngine(threeNotes, deps)
    e.play()
    run(e, startLeadS + 1.5) // inside note 1
    e.pause()
    expect(e.status).toBe('paused')
    expect(live().map((s) => s.bar)).toEqual([0, 2]) // note 2 not yet sounding
    run(e, 3) // nothing happens while paused
    expect(live()).toHaveLength(2)
    const resumedAt = clock
    e.play()
    run(e, 3)
    expect(live().map((s) => s.bar)).toEqual([0, 2, 4])
    // Note 2 starts 0.5 s of score time after the pause point.
    expect(live()[2].when).toBeCloseTo(resumedAt + startLeadS + 0.5, 2)
  })

  it('changes tempo mid-play without skipping or repeating notes', () => {
    const e = new PlaybackEngine(threeNotes, deps)
    e.play()
    run(e, startLeadS + 0.5)
    e.setTempo(0.5)
    run(e, 6)
    expect(live().map((s) => s.bar)).toEqual([0, 2, 4])
  })

  it('loops with a gap between passes', () => {
    const e = new PlaybackEngine(threeNotes, deps)
    e.setLoop(true)
    e.play()
    run(e, 4 + loopGapMs / 1000 + 0.5)
    const bars = live().map((s) => s.bar)
    expect(bars.slice(0, 4)).toEqual([0, 2, 4, 0])
    expect(live()[3].when - live()[0].when).toBeCloseTo(4 + loopGapMs / 1000, 6)
    expect(e.status).toBe('playing')
  })

  it('restarts from the top', () => {
    const e = new PlaybackEngine(threeNotes, deps)
    e.play()
    run(e, 1.5)
    e.restart()
    run(e, 0.2)
    expect(live().at(-1)!.bar).toBe(0)
  })

  it('steps one note per call, immediately, wrapping at the end', () => {
    const e = new PlaybackEngine(threeNotes, deps)
    expect([e.step(), e.step(), e.step(), e.step()]).toEqual([0, 1, 2, 0])
    expect(live().map((s) => s.bar)).toEqual([0, 2, 4, 0])
    expect(live()[0].when).toBe(clock)
    expect(e.frame().current).toBe(0)
  })

  it('handles an empty tune', () => {
    const e = new PlaybackEngine([], deps)
    e.play()
    run(e, 1)
    expect(sounded).toHaveLength(0)
    expect(e.status).toBe('ended')
  })
})
