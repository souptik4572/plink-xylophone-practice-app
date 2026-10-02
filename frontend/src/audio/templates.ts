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

/** Hann-windowed magnitude spectrum of fftSize samples, 200–6000 Hz bins only, unit length. */
export function spectrum(samples: ArrayLike<number>, sampleRate: number): Float64Array {
  const n = cfg.fftSize
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = (samples[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
  fft(re, im)
  const binHz = sampleRate / n
  const lo = Math.ceil(cfg.minHz / binHz)
  const hi = Math.min(n / 2, Math.floor(cfg.maxHz / binHz))
  const out = new Float64Array(hi - lo + 1)
  for (let k = lo; k <= hi; k++) out[k - lo] = Math.hypot(re[k], im[k])
  return normalise(out)
}

/** A bar's template: the mean of its calibration spectra, unit length. */
export function averageTemplate(spectra: ArrayLike<number>[]): number[] {
  const out = new Array<number>(spectra[0].length).fill(0)
  for (const s of spectra) for (let i = 0; i < out.length; i++) out[i] += s[i]
  return normalise(out)
}
