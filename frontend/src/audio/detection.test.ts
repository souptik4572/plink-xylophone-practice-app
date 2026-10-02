import { describe, expect, it } from 'vitest'
import { barFrequency, DEFAULT_INSTRUMENT } from '../instrument'
import { audioConfig } from './audioConfig'
import { confusionGrid, matchSpectrum } from './matcher'
import { createOnsetDetector, createStrikePipeline, measureNoiseFloor } from './onset'
import { averageTemplate, fft, spectrum } from './templates'

const SR = 48000
const cfg = audioConfig.detection

// Deterministic PRNG so the synthetic tests never flake.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}
const rand = rng(42)

/**
 * A synthetic struck bar: a decaying fundamental plus the inharmonic
 * overtones real xylophone bars have, with the strength, detune and
 * overtone balance varying from strike to strike.
 */
function strike(freq: number, seconds = 0.4, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  const f = freq * (1 + (rand() - 0.5) * 0.006)
  const a = amp * (0.6 + rand() * 0.8)
  const partials = [
    [1, 1, 6],
    [2.76, 0.3 + rand() * 0.3, 10],
    [5.4, 0.1 + rand() * 0.15, 16],
  ]
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    let s = 0
    for (const [ratio, gain, decay] of partials) s += gain * Math.exp(-decay * t) * Math.sin(2 * Math.PI * f * ratio * t)
    out[i] = a * s
  }
  return out
}

function noise(seconds: number, level = 0.002): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  for (let i = 0; i < out.length; i++) out[i] = (rand() * 2 - 1) * level
  return out
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Mix a strike into room noise, as the mic would hear it. */
const heard = (freq: number) => {
  const s = strike(freq)
  const n = noise(s.length / SR)
  return s.map((v, i) => v + n[i])
}

const freqs = DEFAULT_INSTRUMENT.bars.map((_, i) => barFrequency(DEFAULT_INSTRUMENT, i))

/** Feed a signal through the pipeline in mic-sized chunks; collect spectra. */
function capture(signal: Float32Array, floor = 0.002) {
  const got: Float64Array[] = []
  const push = createStrikePipeline(SR, floor, (spec) => got.push(spec))
  for (let i = 0; i < signal.length; i += 1024) push(signal.subarray(i, i + 1024))
  return got
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

describe('spectrum', () => {
  it('keeps only the 200–6000 Hz bins and is unit length', () => {
    const s = spectrum(strike(880).subarray(0, cfg.fftSize), SR)
    const binHz = SR / cfg.fftSize
    expect(s.length).toBe(Math.floor(cfg.maxHz / binHz) - Math.ceil(cfg.minHz / binHz) + 1)
    expect(Math.hypot(...s)).toBeCloseTo(1, 6)
  })
})

describe('onset detector', () => {
  it('finds one onset per strike, ignoring the decaying tail', () => {
    const detect = createOnsetDetector(SR, 0.002)
    const signal = concat(noise(0.3), strike(660, 0.8), noise(0.3))
    const onsets = detect(signal)
    expect(onsets).toHaveLength(1)
    expect(Math.abs(onsets[0] - 0.3 * SR)).toBeLessThan((cfg.frameMs / 1000) * SR + 1)
  })

  it('catches fast repeats on the same bar, but not within the refractory period', () => {
    const detect = createOnsetDetector(SR, 0.002)
    const gap = (ms: number) => strike(660, ms / 1000)
    expect(detect(concat(noise(0.2), gap(200), gap(200), gap(200), strike(660)))).toHaveLength(4)
    const detect2 = createOnsetDetector(SR, 0.002)
    expect(detect2(concat(noise(0.2), gap(80), strike(660)))).toHaveLength(1)
  })

  it('stays quiet on room noise', () => {
    expect(createOnsetDetector(SR, 0.002)(noise(2))).toHaveLength(0)
  })

  it('never triggers below the absolute minimum, even in a silent room', () => {
    const quietTap = strike(660, 0.3, cfg.minRms * 0.5)
    expect(createOnsetDetector(SR, 0)(concat(new Float32Array(SR / 10), quietTap))).toHaveLength(0)
  })

  it('measures the noise floor as mean frame RMS', () => {
    expect(measureNoiseFloor(noise(1, 0.01), SR)).toBeCloseTo(0.01 / Math.sqrt(3), 3)
  })
})

describe('calibrate, then match', () => {
  const templates = freqs.map((f) =>
    averageTemplate(Array.from({ length: cfg.strikesPerBar }, () => Array.from(capture(concat(noise(0.2), heard(f)))[0]))),
  )

  it('captures exactly one spectrum per strike through the pipeline', () => {
    expect(capture(concat(noise(0.2), heard(523), heard(659), noise(0.2)))).toHaveLength(2)
  })

  it('recognises 40 fresh strikes, five per bar', () => {
    const trials = freqs.flatMap((f, bar) =>
      Array.from({ length: 5 }, () => {
        const [spec] = capture(concat(noise(0.2), heard(f)))
        return { expected: bar, got: matchSpectrum(spec, templates).bar }
      }),
    )
    const { correct, total } = confusionGrid(trials, freqs.length)
    expect(total).toBe(40)
    expect(correct).toBeGreaterThanOrEqual(cfg.selfTestGate)
  })

  it('reports unsure for a note that is not one of her bars', () => {
    const [spec] = capture(concat(noise(0.2), heard(554.37))) // C#5, between C and D
    expect(matchSpectrum(spec, templates).bar).toBeNull()
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
