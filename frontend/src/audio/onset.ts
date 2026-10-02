import { audioConfig } from './audioConfig'
import { spectrum } from './templates'

const cfg = audioConfig.detection

function rms(frame: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / frame.length)
}

const frameLength = (sampleRate: number) => Math.round((sampleRate * cfg.frameMs) / 1000)

/** Mean RMS over 10 ms frames of room noise. */
export function measureNoiseFloor(samples: Float32Array, sampleRate: number): number {
  const len = frameLength(sampleRate)
  const frames = Math.floor(samples.length / len)
  let sum = 0
  for (let f = 0; f < frames; f++) sum += rms(samples.subarray(f * len, (f + 1) * len))
  return frames ? sum / frames : 0
}

/**
 * Streaming onset detector. Feed it samples in any chunk size; it returns
 * the absolute sample index of each strike's first loud frame.
 */
export function createOnsetDetector(sampleRate: number, noiseFloor: number) {
  const len = frameLength(sampleRate)
  const threshold = Math.max(cfg.noiseMult * noiseFloor, cfg.minRms)
  const refractory = (sampleRate * cfg.refractoryMs) / 1000
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
      if (r > threshold && r > cfg.riseRatio * prevRms && start - lastOnset >= refractory) {
        onsets.push(start)
        lastOnset = start
      }
      prevRms = r
    }
    return onsets
  }
}

/**
 * Onsets in, spectra out: for each strike, waits for the samples from 20 ms
 * after the onset to fill one FFT window, then hands over its spectrum.
 */
export function createStrikePipeline(
  sampleRate: number,
  noiseFloor: number,
  onSpectrum: (spec: Float64Array, onsetIndex: number) => void,
) {
  const detect = createOnsetDetector(sampleRate, noiseFloor)
  const skip = Math.round((sampleRate * cfg.skipMs) / 1000)
  const keep = skip + cfg.fftSize + sampleRate // enough history for any pending window
  let buffer = new Float32Array(0)
  let bufferStart = 0 // absolute index of buffer[0]
  const pending: number[] = []

  return (samples: Float32Array) => {
    const next = new Float32Array(buffer.length + samples.length)
    next.set(buffer)
    next.set(samples, buffer.length)
    buffer = next
    pending.push(...detect(samples))

    while (pending.length) {
      const from = pending[0] + skip - bufferStart
      if (from + cfg.fftSize > buffer.length) break
      const onset = pending.shift()!
      onSpectrum(spectrum(buffer.subarray(from, from + cfg.fftSize), sampleRate), onset)
    }

    if (buffer.length > keep) {
      const drop = buffer.length - keep
      buffer = buffer.slice(drop)
      bufferStart += drop
    }
  }
}
