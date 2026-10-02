import { audioConfig } from './audioConfig'
import { matchSpectrum, type Match } from './matcher'
import { createStrikePipeline, measureNoiseFloor } from './onset'
import { getAudioContext, isAppSounding } from './synth'
import { strikeBus } from '../player/barStrike'
import { isSpeaking } from '../voice'

const cfg = audioConfig.detection

// Served as a plain file from public/: addModule needs a real URL, not an inlined data: URL.
const WORKLET_URL = '/capture.worklet.js'

let workletLoaded: Promise<void> | null = null

/**
 * Opens the mic and streams raw samples to `onSamples`. Speech processing is
 * off: echo cancellation, noise suppression and auto gain distort musical tones.
 * Returns a function that closes the mic.
 */
export async function openMic(onSamples: (s: Float32Array) => void): Promise<{ sampleRate: number; close: () => void }> {
  const ctx = getAudioContext()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  })
  workletLoaded ??= ctx.audioWorklet.addModule(WORKLET_URL)
  await workletLoaded
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'plink-capture')
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data)
  // The worklet must reach the destination to be pulled; a silent gain keeps it inaudible.
  const silent = ctx.createGain()
  silent.gain.value = 0
  source.connect(node).connect(silent).connect(ctx.destination)
  return {
    sampleRate: ctx.sampleRate,
    close() {
      source.disconnect()
      node.disconnect()
      silent.disconnect()
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}

/** Records about a second of room tone and returns its mean frame RMS. */
export async function recordNoiseFloor(): Promise<number> {
  const sampleRate = getAudioContext().sampleRate
  const chunks: Float32Array[] = []
  let total = 0
  let finish!: () => void
  const done = new Promise<void>((r) => (finish = r))
  const mic = await openMic((s) => {
    chunks.push(s)
    total += s.length
    if (total >= sampleRate * cfg.noiseMeasureS) finish()
  })
  await done
  mic.close()
  const all = new Float32Array(total)
  let o = 0
  for (const c of chunks) {
    all.set(c, o)
    o += c.length
  }
  return measureNoiseFloor(all, sampleRate)
}

/**
 * Listens for strikes and hands each one's spectrum to `onSpectrum`. While the
 * app itself is making sound or speaking, strikes are dropped (self-mute).
 */
export async function listenForStrikes(noiseFloor: number, onSpectrum: (spec: Float64Array) => void) {
  let push: ((s: Float32Array) => void) | null = null
  const mic = await openMic((s) => push?.(s))
  push = createStrikePipeline(mic.sampleRate, noiseFloor, (spec) => {
    if (!isAppSounding(cfg.selfMuteTailS) && !isSpeaking()) onSpectrum(spec)
  })
  return mic.close
}

/**
 * The mic as a strike source: matched strikes go onto the shared BarStrike
 * stream with source 'mic'. `onMatch` also sees unsure strikes.
 */
export function listenForBars(noiseFloor: number, templates: number[][], onMatch?: (m: Match) => void) {
  return listenForStrikes(noiseFloor, (spec) => {
    const m = matchSpectrum(spec, templates)
    onMatch?.(m)
    if (m.bar !== null) strikeBus.emit({ bar: m.bar, source: 'mic', t: performance.now() })
  })
}
