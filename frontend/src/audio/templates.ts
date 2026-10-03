import { audioConfig } from './audioConfig'

const cfg = audioConfig.detection

/** In-place iterative radix-2 FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        ;[cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr]
      }
    }
  }
}

export function normalise<T extends Float64Array | number[]>(v: T): T {
  let sum = 0
  for (const x of v) sum += x * x
  const norm = Math.sqrt(sum) || 1
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

/** Samples in one spectrum: the power of two nearest the window length at this sample rate. */
export const windowSize = (sampleRate: number) => 2 ** Math.round(Math.log2((sampleRate * cfg.windowMs) / 1000))

const perOctave = 12 * cfg.bandsPerSemitone
/** Bands on a musical scale from minHz to maxHz, the same at any sample rate. */
export const BANDS = Math.round(perOctave * Math.log2(cfg.maxHz / cfg.minHz)) + 1
export const bandHz = (band: number) => cfg.minHz * 2 ** (band / perOctave)
export const semitones = (fromHz: number, toHz: number) => 12 * Math.log2(toHz / fromHz)

/**
 * The window's magnitude spectrum on the musical scale: each band takes the
 * strongest FFT bin inside it, or the spectrum interpolated at its centre where
 * bins are wider than bands (low notes).
 */
export function bandMagnitudes(samples: ArrayLike<number>, sampleRate: number): Float64Array {
  const n = windowSize(sampleRate)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = (samples[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
  fft(re, im)
  const mag = new Float64Array(n / 2 + 1)
  for (let k = 0; k <= n / 2; k++) mag[k] = Math.hypot(re[k], im[k])
  const binHz = sampleRate / n
  const out = new Float64Array(BANDS)
  for (let b = 0; b < BANDS; b++) {
    const at = bandHz(b) / binHz
    const k0 = Math.min(Math.floor(at), n / 2 - 1)
    let v = mag[k0] + (mag[k0 + 1] - mag[k0]) * (at - k0)
    const hi = Math.min(n / 2, Math.floor(bandHz(b + 0.5) / binHz))
    for (let k = Math.ceil(bandHz(b - 0.5) / binHz); k <= hi; k++) v = Math.max(v, mag[k])
    out[b] = v
  }
  return out
}

const BLUR = [1, 2, 3, 2, 1].map((w) => w / 9)

/**
 * What the matcher compares: band magnitudes blurred over half a semitone, so
 * a bar that drifted ~1% from its calibrated pitch still lines up while
 * neighbouring bars (a semitone or more apart) stay apart; then unit length.
 */
export function features(bands: ArrayLike<number>): Float64Array {
  const out = new Float64Array(bands.length)
  const reach = (BLUR.length - 1) / 2
  for (let b = 0; b < bands.length; b++) for (let j = -reach; j <= reach; j++) out[b] += BLUR[j + reach] * (bands[b + j] ?? 0)
  return normalise(out)
}

/**
 * The bar's pitch: its lowest strong peak. A struck bar's fundamental is its
 * lowest partial; its overtones (2.76×, 5.4×) sit above it.
 */
export function pitchHz(bands: ArrayLike<number>): number {
  let max = 0
  for (let b = 0; b < bands.length; b++) max = Math.max(max, bands[b])
  for (let b = 0; b < bands.length; b++) {
    const peak = bands[b] >= (bands[b - 1] ?? 0) && bands[b] >= (bands[b + 1] ?? 0)
    if (peak && bands[b] >= cfg.pitchPeakShare * max) return bandHz(b)
  }
  return bandHz(0)
}

/**
 * How tonal a sound is: the share of its energy close to its few strongest
 * peaks. A struck bar is a handful of partials; a clap, a voice or a babble
 * spreads its energy much wider.
 */
export function peakShare(bands: ArrayLike<number>): number {
  const power = Array.from(bands, (v) => v * v)
  const total = power.reduce((s, p) => s + p, 0) || 1
  const taken = new Array<boolean>(power.length).fill(false)
  const reach = Math.round(cfg.tonalReachSemitones * cfg.bandsPerSemitone)
  let kept = 0
  for (let n = 0; n < cfg.tonalPeaks; n++) {
    let best = -1
    for (let b = 0; b < power.length; b++) if (!taken[b] && (best < 0 || power[b] > power[best])) best = b
    if (best < 0) break
    for (let b = Math.max(0, best - reach); b <= Math.min(power.length - 1, best + reach); b++) {
      if (!taken[b]) kept += power[b]
      taken[b] = true
    }
  }
  return kept / total
}

/** A bar's template: the mean of its calibration features, unit length. */
export function averageTemplate(spectra: ArrayLike<number>[]): number[] {
  const out = new Array<number>(spectra[0].length).fill(0)
  for (const s of spectra) for (let i = 0; i < out.length; i++) out[i] += s[i]
  return normalise(out)
}
