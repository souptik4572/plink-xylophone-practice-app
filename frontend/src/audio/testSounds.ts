// Synthetic sounds for the detection tests: struck bars, and the noises a room
// makes. Deterministic (seeded), and at any sample rate.

export function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

export interface Room {
  sr: number
  rand: () => number
}

export const room = (sr: number, seed = 42): Room => ({ sr, rand: rng(seed) })

const len = (r: Room, s: number) => Math.round(s * r.sr)

/**
 * A struck bar: a decaying fundamental plus the inharmonic overtones of a free
 * bar (2.76×, 5.4×), and the mallet's click. Strength, detune and overtone
 * balance vary from strike to strike. `ring` is the fundamental's decay time:
 * ~0.08 s for a wooden toy, ~0.4 s for a metal glockenspiel.
 */
export function strike(r: Room, freq: number, o: { seconds?: number; amp?: number; ring?: number; detune?: number } = {}) {
  const { seconds = 0.5, amp = 0.5, ring = 0.15, detune = 0 } = o
  const out = new Float32Array(len(r, seconds))
  const f = freq * (1 + detune) * (1 + (r.rand() - 0.5) * 0.004)
  const a = amp * (0.6 + r.rand() * 0.8)
  const partials = [
    [1, 1, ring],
    [2.76, 0.25 + r.rand() * 0.35, ring * 0.5],
    [5.4, 0.08 + r.rand() * 0.15, ring * 0.3],
  ]
  const phase = partials.map(() => r.rand() * 2 * Math.PI)
  for (let i = 0; i < out.length; i++) {
    const t = i / r.sr
    let s = 0
    partials.forEach(([ratio, gain, tau], p) => (s += gain * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * ratio * t + phase[p])))
    // The mallet's click: a couple of milliseconds of broadband noise.
    s += 0.6 * Math.exp(-t / 0.0015) * (r.rand() * 2 - 1)
    out[i] = a * s
  }
  return out
}

/** A hand clap: a sharp broadband burst and a smaller echo, gone in ~30 ms. */
export function clap(r: Room, amp = 0.6) {
  const out = new Float32Array(len(r, 0.25))
  for (let i = 0; i < out.length; i++) {
    const t = i / r.sr
    const env = Math.exp(-t / 0.007) + 0.3 * (t > 0.012 ? Math.exp(-(t - 0.012) / 0.01) : 0)
    out[i] = amp * env * (r.rand() * 2 - 1)
  }
  return out
}

/** A knock on the table or a footstep: a low thump with a little click. */
export function knock(r: Room, amp = 0.6) {
  const out = new Float32Array(len(r, 0.3))
  const f = 70 + r.rand() * 80
  for (let i = 0; i < out.length; i++) {
    const t = i / r.sr
    out[i] = amp * (Math.exp(-t / 0.04) * Math.sin(2 * Math.PI * f * t) + 0.15 * Math.exp(-t / 0.002) * (r.rand() * 2 - 1))
  }
  return out
}

/** A laptop key or a mallet set down: a click of a few milliseconds. */
export function click(r: Room, amp = 0.4) {
  const out = new Float32Array(len(r, 0.15))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.exp(-i / r.sr / 0.0025) * (r.rand() * 2 - 1)
  return out
}

/**
 * A voiced vowel: harmonics of f0 shaped by two formants, with a soft attack
 * and a little vibrato, like someone saying "okay" beside the instrument.
 */
export function vowel(r: Room, f0: number, o: { seconds?: number; amp?: number; formants?: [number, number] } = {}) {
  const { seconds = 0.35, amp = 0.3, formants = [700, 1200] } = o
  const out = new Float32Array(len(r, seconds))
  const harmonics: [number, number][] = []
  for (let k = 1; k * f0 < 6000; k++) {
    const f = k * f0
    const g = formants.reduce((s, fc) => s + 1 / (1 + ((f - fc) / 120) ** 2), 0.05) / k ** 0.3
    harmonics.push([k, g])
  }
  const total = harmonics.reduce((s, [, g]) => s + g, 0)
  for (let i = 0; i < out.length; i++) {
    const t = i / r.sr
    const env = Math.min(1, t / 0.03) * Math.min(1, (seconds - t) / 0.05)
    const pitch = f0 * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * t))
    let s = 0
    for (const [k, g] of harmonics) s += g * Math.sin(2 * Math.PI * pitch * k * t)
    out[i] = (amp * env * s) / total
  }
  return out
}

/** Steady room tone. */
export function hiss(r: Room, seconds: number, level = 0.002) {
  const out = new Float32Array(len(r, seconds))
  for (let i = 0; i < out.length; i++) out[i] = (r.rand() * 2 - 1) * level
  return out
}

export function concat(...parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Mix `sound` into room tone, as the mic hears it. */
export function heard(r: Room, sound: Float32Array, level = 0.002) {
  const n = hiss(r, sound.length / r.sr, level)
  return sound.map((v, i) => v + n[i])
}
