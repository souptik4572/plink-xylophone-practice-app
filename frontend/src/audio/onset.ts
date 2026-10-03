import { audioConfig } from './audioConfig'
import { bandMagnitudes, features, peakShare, pitchHz, windowSize } from './templates'

const cfg = audioConfig.detection

/** One sound the mic heard after an onset: a struck bar, or a noise the gate turned away. */
export interface Sound {
  /** Absolute sample index of the onset. */
  onset: number
  features: Float64Array
  pitchHz: number
  /** Why it is not a bar: it died away (a clap, a knock), swelled (a voice), or spread its energy (a babble). */
  rejected: 'short' | 'swell' | 'noisy' | null
}

function rms(frame: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / (frame.length || 1))
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
}

const frameLength = (sampleRate: number) => Math.round((sampleRate * cfg.frameMs) / 1000)

/** A streaming 4th-order Butterworth high-pass at highPassHz (two biquads); state carries across chunks. */
export function createHighPass(sampleRate: number) {
  const w = (2 * Math.PI * cfg.highPassHz) / sampleRate
  const stages = [0.5412, 1.3066].map((q) => {
    const alpha = Math.sin(w) / (2 * q)
    const cos = Math.cos(w)
    const a0 = 1 + alpha
    return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 }
  })
  return (samples: ArrayLike<number>): Float32Array => {
    const out = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      let x = samples[i]
      for (const s of stages) {
        const y = s.b0 * x + s.b1 * s.x1 + s.b0 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2
        s.x2 = s.x1
        s.x1 = x
        s.y2 = s.y1
        s.y1 = y
        x = y
      }
      out[i] = x
    }
    return out
  }
}

/** The room's level: the median 10 ms frame RMS above highPassHz, so a cough while measuring doesn't count. */
export function measureNoiseFloor(samples: Float32Array, sampleRate: number): number {
  const filtered = createHighPass(sampleRate)(samples)
  const len = frameLength(sampleRate)
  const levels: number[] = []
  for (let f = 0; f + len <= filtered.length; f += len) levels.push(rms(filtered.subarray(f, f + len)))
  return percentile(levels, 0.5)
}

/**
 * Streaming onset detector, fed high-passed samples in any chunk size. Returns
 * the absolute sample index of each strike's first loud frame. The threshold
 * follows the room: the calibrated floor at first, then the quiet end of the
 * last few seconds.
 */
export function createOnsetDetector(sampleRate: number, noiseFloor: number) {
  const len = frameLength(sampleRate)
  const refractory = (sampleRate * cfg.refractoryMs) / 1000
  const remember = Math.round((cfg.floorWindowS * 1000) / cfg.frameMs)
  const recent: number[] = []
  const frame = new Float32Array(len)
  let filled = 0
  let index = 0
  let prevRms = Infinity
  let lastOnset = -Infinity

  return (samples: ArrayLike<number>): number[] => {
    const onsets: number[] = []
    for (let i = 0; i < samples.length; i++, index++) {
      frame[filled++] = samples[i]
      if (filled < len) continue
      filled = 0
      const r = rms(frame)
      const start = index - len + 1
      // A second of listening before the room's own level takes over from the calibrated one.
      const floor = recent.length * cfg.floorWindowS >= remember ? percentile(recent, cfg.floorPercentile) : noiseFloor
      if (r > Math.max(cfg.noiseMult * floor, cfg.minRms) && r > cfg.riseRatio * prevRms && start - lastOnset >= refractory) {
        onsets.push(start)
        lastOnset = start
      }
      recent.push(r)
      if (recent.length > remember) recent.shift()
      prevRms = r
    }
    return onsets
  }
}

/** A bar rings on after its click, only ever decaying, as a few clear partials; anything else is a noise. */
function judge(attackRms: number, windowRms: number, bands: Float64Array): Sound['rejected'] {
  if (windowRms < cfg.minSustain * attackRms) return 'short'
  if (windowRms > cfg.maxSustain * attackRms) return 'swell'
  if (peakShare(bands) < cfg.minPeakShare) return 'noisy'
  return null
}

/**
 * Raw mic samples in, sounds out: high-passes them, finds onsets, waits for the
 * window from 20 ms after each onset, and hands over its features with the
 * gate's verdict.
 */
export function createStrikePipeline(sampleRate: number, noiseFloor: number, onSound: (sound: Sound) => void) {
  const highPass = createHighPass(sampleRate)
  const detect = createOnsetDetector(sampleRate, noiseFloor)
  const size = windowSize(sampleRate)
  const skip = Math.round((sampleRate * cfg.skipMs) / 1000)
  const keep = skip + size + sampleRate // enough history for any pending window
  let buffer = new Float32Array(0)
  let bufferStart = 0 // absolute index of buffer[0]
  const pending: number[] = []

  return (raw: Float32Array) => {
    const samples = highPass(raw)
    const next = new Float32Array(buffer.length + samples.length)
    next.set(buffer)
    next.set(samples, buffer.length)
    buffer = next
    pending.push(...detect(samples))

    while (pending.length) {
      const at = pending[0] - bufferStart
      if (at + skip + size > buffer.length) break
      const onset = pending.shift()!
      const window = buffer.subarray(at + skip, at + skip + size)
      const bands = bandMagnitudes(window, sampleRate)
      onSound({
        onset,
        features: features(bands),
        pitchHz: pitchHz(bands),
        rejected: judge(rms(buffer.subarray(at, at + skip)), rms(window), bands),
      })
    }

    if (buffer.length > keep) {
      const drop = buffer.length - keep
      buffer = buffer.slice(drop)
      bufferStart += drop
    }
  }
}
