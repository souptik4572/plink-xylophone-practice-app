import { audioConfig } from './audioConfig'
import { averageTemplate, semitones } from './templates'

const cfg = audioConfig.detection

/** A bar Plink has learned: its averaged features and the pitch it rang at. */
export interface LearnedBar {
  template: number[]
  pitchHz: number
}

export interface CalibrationStrike {
  features: ArrayLike<number>
  pitchHz: number
}

export type BarVerdict =
  | { ok: true; learned: LearnedBar }
  | { ok: false; problem: 'mixed' }
  | { ok: false; problem: 'twin'; twin: number }
  | { ok: false; problem: 'lower' | 'skipped'; pitchHz: number }

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * One bar's calibration strikes, checked against the bars learned before it.
 * Bars are learned low to high, so each must sound higher than the last, by
 * about the instrument's own step (`stepSemitones`); a much bigger jump means
 * a bar was skipped, which would shift every bar after it. `trustPitchHz` is a
 * big jump heard before on this bar: the same jump twice is the instrument
 * itself, not a mistake.
 */
export function checkBar(strikes: CalibrationStrike[], learned: LearnedBar[], stepSemitones: number, trustPitchHz?: number): BarVerdict {
  const template = averageTemplate(strikes.map((s) => s.features))
  const pitches = strikes.map((s) => s.pitchHz).sort((a, b) => a - b)
  const pitchHz = pitches[Math.floor(pitches.length / 2)]
  const mixed = strikes.some((s) => dot(s.features, template) < cfg.calibrateConsistency || Math.abs(semitones(pitchHz, s.pitchHz)) > cfg.pitchAgreeSemitones)
  if (mixed) return { ok: false, problem: 'mixed' }
  const twin = learned.findIndex((l) => dot(l.template, template) > cfg.calibrateDistinct)
  if (twin >= 0) return { ok: false, problem: 'twin', twin }
  const previous = learned.at(-1)
  if (previous) {
    const step = semitones(previous.pitchHz, pitchHz)
    // Pitches are read to a quarter of a semitone, and neighbouring bars are at least a semitone apart.
    if (step < 0.25) return { ok: false, problem: 'lower', pitchHz }
    const confirmed = trustPitchHz !== undefined && Math.abs(semitones(trustPitchHz, pitchHz)) <= 0.5
    if (step > stepSemitones + cfg.skipSlackSemitones && !confirmed) return { ok: false, problem: 'skipped', pitchHz }
  }
  return { ok: true, learned: { template, pitchHz } }
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

/** The nearest note to a pitch, for showing the grown-up what Plink heard: 1046 → "C6". */
export function noteName(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440))
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}
