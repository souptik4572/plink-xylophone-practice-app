import { audioConfig } from '../audio/audioConfig'
import type { Instrument } from '../instrument'

const cfg = audioConfig.addSong

export interface RecordedTune {
  bars: number[]
  beats: number[]
  msPerBeat: number
}

/**
 * Play it in (spec 7.7): the parent plays the tune slowly; the gap after
 * each strike, measured against the typical gap, becomes its length,
 * snapped to the nearest half beat.
 */
export function snapToBeats(strikes: { bar: number; t: number }[]): RecordedTune {
  const kept = strikes.filter((s, i) => i === 0 || s.t - strikes[i - 1].t >= cfg.minGapMs)
  const bars = kept.map((s) => s.bar)
  const gaps = kept.slice(1).map((s, i) => s.t - kept[i].t)
  if (gaps.length === 0) return { bars, beats: bars.map(() => 1), msPerBeat: 0 }

  // The median gap: in a tune most notes are one beat, so it is the beat.
  const sorted = [...gaps].sort((a, b) => a - b)
  const msPerBeat = sorted[Math.floor((sorted.length - 1) / 2)]
  const beats = gaps.map((g) => Math.min(cfg.maxBeats, Math.max(0.5, Math.round((g / msPerBeat) * 2) / 2)))
  return { bars, beats: [...beats, 1], msPerBeat }
}

/** Letters such as "C C G G A A G:2" to bars, by the instrument's own labels. "C'" is the high C. */
export function lettersToTune(text: string, instrument: Instrument): { bars: number[]; beats: number[] } | string {
  const labels = instrument.bars.map((b) => b.label.toUpperCase().replace('′', "'"))
  const bars: number[] = []
  const beats: number[] = []
  for (const tok of text.trim().split(/[\s,]+/).filter(Boolean)) {
    const [name, len] = tok.replace('′', "'").split(':')
    const bar = labels.indexOf(name.toUpperCase())
    if (bar < 0) return `"${name}" is not one of her bars (${instrument.bars.map((b) => b.label).join(' ')})`
    const b = len ? Number(len) : 1
    if (!(b > 0 && b <= audioConfig.addSong.maxBeats)) return `"${tok}" has a length Plink can't use`
    bars.push(bar)
    beats.push(b)
  }
  return bars.length ? { bars, beats } : 'Type at least one note'
}
