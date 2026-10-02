import { audioConfig } from './audioConfig'

// The built-in xylophone's voice: a sine at the bar's pitch, a quieter upper
// partial, a few ms of filtered noise for the mallet click, and an exponential
// decay. No sample files. Each strike makes its own short-lived nodes, so
// chords and fast repeats never cut each other off.

const cfg = audioConfig.synth

let ctx: AudioContext | null = null
let master: GainNode
let noise: AudioBuffer
/** Audio-clock time until which the app itself is making sound (for mic self-mute). */
let soundingUntil = 0

/** The shared AudioContext. Call from a user gesture first, to satisfy autoplay rules. */
export function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' })
    const comp = ctx.createDynamicsCompressor()
    comp.connect(ctx.destination)
    master = ctx.createGain()
    master.gain.value = cfg.masterGain
    master.connect(comp)
    noise = ctx.createBuffer(1, Math.ceil((ctx.sampleRate * cfg.clickMs) / 1000), ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Audio-clock time without creating the context (0 before the first gesture). */
export function audioNow(): number {
  return ctx ? ctx.currentTime : 0
}

/** True while any tone the app made is still ringing, or rang within `tailS`. */
export function isAppSounding(tailS = 0): boolean {
  return ctx !== null && ctx.currentTime < soundingUntil + tailS
}

/** Strike a bar at `when` (audio-clock seconds, default now). Returns a cancel function. */
export function playTone(freq: number, when?: number): () => void {
  const ac = getAudioContext()
  const t = Math.max(when ?? ac.currentTime, ac.currentTime)
  const end = t + cfg.decayS
  soundingUntil = Math.max(soundingUntil, end)

  const voice = (f: number, gain: number, decay: number) => {
    const osc = ac.createOscillator()
    osc.frequency.value = f
    const g = ac.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + cfg.attackS)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    osc.connect(g).connect(master)
    osc.start(t)
    osc.stop(t + decay + 0.02)
    osc.onended = () => g.disconnect()
    return osc
  }

  const fundamental = voice(freq, 1, cfg.decayS)
  const partial = voice(freq * cfg.partialRatio, cfg.partialGain, cfg.partialDecayS)

  const click = ac.createBufferSource()
  click.buffer = noise
  const band = ac.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = cfg.clickFreqHz
  const cg = ac.createGain()
  cg.gain.value = cfg.clickGain
  click.connect(band).connect(cg).connect(master)
  click.start(t)
  click.onended = () => cg.disconnect()

  return () => {
    // Stopping a node before its start time means it never sounds.
    for (const n of [fundamental, partial, click]) {
      try {
        n.stop()
      } catch {
        /* already stopped */
      }
    }
  }
}
