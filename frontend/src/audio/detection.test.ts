import { describe, expect, it } from 'vitest'
import { barFrequency, DEFAULT_INSTRUMENT } from '../instrument'
import { audioConfig } from './audioConfig'
import { checkBar, noteName, type LearnedBar } from './calibration'
import { confusionGrid, matchSpectrum } from './matcher'
import { createHighPass, createOnsetDetector, createStrikePipeline, measureNoiseFloor, type Sound } from './onset'
import { averageTemplate, BANDS, bandHz, bandMagnitudes, features, fft, pitchHz, semitones, windowSize } from './templates'
import { clap, click, concat, heard, hiss, knock, room, strike, vowel, type Room } from './testSounds'

const cfg = audioConfig.detection
const base = DEFAULT_INSTRUMENT.bars.map((_, i) => barFrequency(DEFAULT_INSTRUMENT, i)) // C5–C6
const high = base.map((f) => f * 2) // a toy glockenspiel's C6–C7

/** Feed a signal through the pipeline in mic-sized chunks; collect what it heard. */
function listen(r: Room, signal: Float32Array, floor = 0.002) {
  const got: Sound[] = []
  const push = createStrikePipeline(r.sr, floor, (s) => got.push(s))
  for (let i = 0; i < signal.length; i += 1024) push(signal.subarray(i, i + 1024))
  return got
}

/** One sound in a quiet room, as the pipeline hears it. */
const hear = (r: Room, sound: Float32Array, level = 0.002) => listen(r, concat(hiss(r, 0.2, level), heard(r, sound, level), hiss(r, 0.3, level)), level)

function calibrate(r: Room, freqs: number[], ring: number) {
  return freqs.map((f) => averageTemplate(Array.from({ length: cfg.strikesPerBar }, () => hear(r, strike(r, f, { ring }))[0].features)))
}

function selfTest(r: Room, templates: number[][], freqs: number[], o: { ring: number; detune?: number; level?: number }) {
  const trials = freqs.flatMap((f, bar) =>
    Array.from({ length: 5 }, () => {
      const [s] = hear(r, strike(r, f, o), o.level)
      return { expected: bar, got: s && !s.rejected ? matchSpectrum(s.features, templates).bar : null }
    }),
  )
  return confusionGrid(trials, freqs.length)
}

describe('fft', () => {
  it('puts a pure tone in the right bin', () => {
    const n = 1024
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 32 * i) / n)
    fft(re, im)
    const mags = Array.from(re.subarray(0, n / 2), (r, k) => Math.hypot(r, im[k]))
    expect(mags.indexOf(Math.max(...mags))).toBe(32)
  })
})

describe('spectrum on a musical scale', () => {
  const tone = (sr: number, f: number) => Float32Array.from({ length: windowSize(sr) }, (_, i) => Math.sin((2 * Math.PI * f * i) / sr))

  it('has the same bands at any sample rate, so a calibration travels between devices', () => {
    for (const sr of [44100, 48000, 96000]) {
      for (const f of [523.25, 1046.5, 3000]) {
        const bands = bandMagnitudes(tone(sr, f), sr)
        expect(bands).toHaveLength(BANDS)
        const peak = bands.indexOf(Math.max(...bands))
        // Within a quarter semitone: at low notes the FFT bin (~0.2 semitone at C5), not the band, is the limit.
        expect(Math.abs(semitones(f, bandHz(peak)))).toBeLessThan(0.25)
      }
    }
  })

  it('features are unit length', () => {
    const f = features(bandMagnitudes(tone(48000, 880), 48000))
    expect(Math.hypot(...f)).toBeCloseTo(1, 6)
  })

  it('reads a struck bar’s pitch from its fundamental, not its overtones', () => {
    const r = room(48000, 3)
    for (const f of [...base, ...high]) {
      const [s] = hear(r, strike(r, f))
      expect(Math.abs(semitones(f, s.pitchHz))).toBeLessThan(0.25)
    }
    expect(noteName(1046.5)).toBe('C6')
    expect(noteName(554.37)).toBe('C♯5')
  })
})

describe('onset detector', () => {
  const r = room(48000, 5)

  it('finds one onset per strike, ignoring the decaying tail', () => {
    const onsets = createOnsetDetector(r.sr, 0.002)(concat(hiss(r, 0.3), strike(r, 660, { seconds: 0.8 }), hiss(r, 0.3)))
    expect(onsets).toHaveLength(1)
    expect(Math.abs(onsets[0] - 0.3 * r.sr)).toBeLessThan((cfg.frameMs / 1000) * r.sr + 1)
  })

  it('catches fast repeats on the same bar, but not within the refractory period', () => {
    const gap = (ms: number) => strike(r, 660, { seconds: ms / 1000 })
    expect(createOnsetDetector(r.sr, 0.002)(concat(hiss(r, 0.2), gap(200), gap(200), gap(200), strike(r, 660)))).toHaveLength(4)
    expect(createOnsetDetector(r.sr, 0.002)(concat(hiss(r, 0.2), gap(80), strike(r, 660)))).toHaveLength(1)
  })

  it('stays quiet on room noise, and below the absolute minimum', () => {
    expect(createOnsetDetector(r.sr, 0.002)(hiss(r, 2))).toHaveLength(0)
    const quietTap = strike(r, 660, { seconds: 0.3, amp: cfg.minRms * 0.3 })
    expect(createOnsetDetector(r.sr, 0)(concat(new Float32Array(r.sr / 10), quietTap))).toHaveLength(0)
  })

  it('follows the room: a TV switched on after calibration stops causing strikes, real ones still count', () => {
    // Calibrated in a quiet room, then a TV's babble of voices starts, loud but quieter than
    // a bar struck near the mic. Two real strikes come at 2.5 s and 3.5 s.
    const tv = room(48000, 6)
    const babble = concat(...Array.from({ length: 16 }, (_, k) => vowel(tv, 110 + (k % 4) * 40, { amp: 0.2, seconds: 0.25 })))
    const signal = heard(tv, babble)
    for (const at of [2.5, 3.5]) signal.set(strike(tv, 880).map((v, i) => v + signal[Math.round(at * tv.sr) + i]), Math.round(at * tv.sr))
    const onsets = createOnsetDetector(tv.sr, 0.002)(createHighPass(tv.sr)(signal)).map((i) => i / tv.sr)
    // Loud enough to fire on the quiet room's threshold, before the room's own level takes over at 1 s...
    expect(onsets.filter((t) => t < 1).length).toBeGreaterThan(0)
    // ...and afterwards only the strikes.
    expect(onsets.filter((t) => t > 1.5).map((t) => Math.round(t * 10) / 10)).toEqual([2.5, 3.5])
  })

  it('measures the room as the median frame level, so a clap while measuring doesn’t count', () => {
    const quiet = measureNoiseFloor(hiss(r, 1, 0.01), r.sr)
    expect(quiet).toBeCloseTo(0.01 / Math.sqrt(3), 3)
    expect(measureNoiseFloor(concat(hiss(r, 0.5, 0.01), clap(r), hiss(r, 0.25, 0.01)), r.sr)).toBeLessThan(quiet * 1.2)
  })
})

describe('strike gate', () => {
  it('takes every struck bar: wooden and metal, loud and soft, at 44.1 and 48 kHz', () => {
    let heardBars = 0
    for (const sr of [44100, 48000]) {
      const r = room(sr, 8)
      for (const f of [...base, ...high])
        for (const o of [{ ring: 0.07 }, { ring: 0.4 }, { ring: 0.1, amp: 0.05 }]) {
          const got = hear(r, strike(r, f, o))
          expect(got).toHaveLength(1)
          if (got[0].rejected === null) heardBars++
        }
    }
    expect(heardBars).toBe(2 * 16 * 3)
  })

  it('turns away claps, knocks, clicks and voices', () => {
    const r = room(48000, 13)
    const noises: [string, () => Float32Array, Sound['rejected'][]][] = [
      ['clap', () => clap(r), ['short']],
      ['knock', () => knock(r), ['short', 'noisy']],
      ['key click', () => click(r), ['short']],
      ['adult voice', () => vowel(r, 95 + r.rand() * 70, { formants: [500 + r.rand() * 300, 1000 + r.rand() * 800] }), ['swell', 'noisy']],
      ['child voice', () => vowel(r, 250 + r.rand() * 100, { formants: [700 + r.rand() * 300, 1600 + r.rand() * 800] }), ['swell', 'noisy']],
      ['child singing "ooo"', () => vowel(r, 300 + r.rand() * 60, { formants: [350, 800] }), ['swell', 'noisy']],
    ]
    for (const [name, make, reasons] of noises) {
      const verdicts = Array.from({ length: 10 }, () => hear(r, make()).map((s) => s.rejected)).flat()
      expect(verdicts.every((v) => reasons.includes(v)), `${name}: ${verdicts.join(',')}`).toBe(true)
    }
  })
})

describe('calibrate, then match', () => {
  for (const [name, freqs, ring] of [['wooden C5–C6', base, 0.08], ['metal C6–C7', high, 0.4]] as const) {
    const templates = calibrate(room(48000, 21), [...freqs], ring)

    it(`${name}: recognises 40 fresh strikes, and still does on a device at 44.1 or 96 kHz`, () => {
      for (const sr of [48000, 44100, 96000]) expect(selfTest(room(sr, 22), templates, [...freqs], { ring }).correct).toBeGreaterThanOrEqual(39)
    })

    it(`${name}: recognises bars that drifted 1% from their calibrated pitch`, () => {
      for (const detune of [0.01, -0.01]) expect(selfTest(room(48000, 23), templates, [...freqs], { ring, detune }).correct).toBeGreaterThanOrEqual(38)
    })

    it(`${name}: still recognises them in a noisier room`, () => {
      expect(selfTest(room(48000, 24), templates, [...freqs], { ring, level: 0.008 }).correct).toBeGreaterThanOrEqual(cfg.selfTestGate)
    })

    it(`${name}: is unsure of a note between two of her bars`, () => {
      const r = room(48000, 25)
      const between = Math.sqrt(freqs[0] * freqs[1]) // C♯, a semitone from both C and D
      expect(matchSpectrum(hear(r, strike(r, between, { ring }))[0].features, templates).bar).toBeNull()
    })
  }
})

describe('calibration order', () => {
  const r = room(48000, 31)
  const strikes = (f: number, n: number = cfg.strikesPerBar) => Array.from({ length: n }, () => hear(r, strike(r, f))[0])
  const learn = (f: number): LearnedBar => {
    const v = checkBar(strikes(f), [], 0)
    if (!v.ok) throw new Error(v.problem)
    return v.learned
  }
  const [C, D, E, F, G] = base
  const learned = [learn(C), learn(D)]

  it('accepts the next bar up', () => {
    expect(checkBar(strikes(E), learned, 2)).toMatchObject({ ok: true })
  })

  it('accepts an out-of-tune toy: E nearly a semitone sharp', () => {
    expect(checkBar(strikes(E * 2 ** (0.8 / 12)), learned, 2)).toMatchObject({ ok: true })
  })

  it('redoes a bar whose strikes disagree', () => {
    expect(checkBar([...strikes(E, 2), ...strikes(G, 1)], learned, 2)).toEqual({ ok: false, problem: 'mixed' })
  })

  it('names the bar that was hit again', () => {
    expect(checkBar(strikes(D), learned, 2)).toEqual({ ok: false, problem: 'twin', twin: 1 })
  })

  it('catches a bar lower than the last one', () => {
    expect(checkBar(strikes(C / 2 ** (1 / 12)), learned, 2)).toMatchObject({ ok: false, problem: 'lower' })
  })

  it('catches a skipped bar, unless the same jump is heard twice', () => {
    const first = checkBar(strikes(G), learned, 2) // G for E: F was skipped
    expect(first).toMatchObject({ ok: false, problem: 'skipped' })
    const trusted = checkBar(strikes(G), learned, 2, (first as { pitchHz: number }).pitchHz)
    expect(trusted).toMatchObject({ ok: true })
    expect(checkBar(strikes(F), learned, 2, (first as { pitchHz: number }).pitchHz)).toMatchObject({ ok: true })
  })

  it('a noise never becomes a calibration strike', () => {
    const r2 = room(48000, 32)
    const got = listen(r2, concat(hiss(r2, 0.2), heard(r2, clap(r2)), hiss(r2, 0.3), heard(r2, vowel(r2, 140)), hiss(r2, 0.3), heard(r2, strike(r2, E)), hiss(r2, 0.3)))
    expect(got.filter((s) => s.rejected === null)).toHaveLength(1)
  })
})

describe('matcher', () => {
  const t = [
    [1, 0, 0],
    [0, 1, 0],
    [0.8, 0.6, 0],
  ]

  it('accepts a clear best match', () => {
    expect(matchSpectrum([0, 1, 0], t)).toMatchObject({ bar: 1, score: 1 })
  })

  it('is unsure below the score threshold', () => {
    expect(matchSpectrum([0, 0.6, 0.8], t).bar).toBeNull()
  })

  it('is unsure when the runner-up is too close', () => {
    // Equidistant from bar 0 and bar 2.
    const v = [0.9487, 0.3162, 0]
    const m = matchSpectrum(v, t)
    expect(m.margin).toBeLessThan(cfg.minMargin)
    expect(m.bar).toBeNull()
  })
})

describe('confusionGrid', () => {
  it('counts hits, misses and unsure strikes', () => {
    const g = confusionGrid(
      [
        { expected: 0, got: 0 },
        { expected: 0, got: 1 },
        { expected: 1, got: null },
        { expected: 1, got: 1 },
      ],
      2,
    )
    expect(g.grid).toEqual([
      [1, 1, 0],
      [0, 1, 1],
    ])
    expect(g).toMatchObject({ correct: 2, total: 4 })
  })
})

describe('pitch', () => {
  it('is the lowest strong peak', () => {
    const bands = new Float64Array(BANDS)
    bands[40] = 1
    bands[60] = 0.7
    bands[80] = 0.2
    expect(pitchHz(bands)).toBe(bandHz(40))
  })
})
