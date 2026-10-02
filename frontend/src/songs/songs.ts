import { audioConfig } from '../audio/audioConfig'
import type { Instrument } from '../instrument'
import { songToNotes, type ReplayNote } from '../player/playback'
import builtin from './builtin.json'
import { parseNotes, toDefaultBars, type SongDef } from './notation'

export interface Phrase {
  start: number
  /** Inclusive. */
  end: number
  nickname: string
  tip: string
}

/** A song as the backend returns it: fitted onto her bars, split into phrases. */
export interface ApiSong {
  id: string
  title: string
  source: string
  notes: string
  bars: number[]
  beats: number[]
  misfits: number[]
  fit_score: number
  transposition: number
  phrases: Phrase[]
  lesson: 'gemma' | 'fallback'
}

/** Replay notes for a whole song, or one phrase of it. */
export function replayNotes(song: ApiSong, phrase?: Phrase): ReplayNote[] {
  const from = phrase?.start ?? 0
  const to = (phrase?.end ?? song.bars.length - 1) + 1
  const misfit = new Set(song.misfits)
  const items = song.bars.slice(from, to).map((bar, i) => ({
    bar,
    beats: song.beats[from + i],
    misfit: misfit.has(from + i),
  }))
  return songToNotes(items, audioConfig.playback.bpm)
}

export const phraseBars = (song: ApiSong, p: Phrase) => song.bars.slice(p.start, p.end + 1)

/** Built-in tunes without the server: only those that fit as written, no phrases. */
export function offlineSongs(instrument: Instrument): ApiSong[] {
  return (builtin as SongDef[]).flatMap((s) => {
    const placed = toDefaultBars(parseNotes(s.notes), instrument)
    if (!placed) return []
    return [
      {
        ...s,
        source: 'builtin',
        bars: placed.map((n) => n.bar),
        beats: placed.map((n) => n.beats),
        misfits: [],
        fit_score: 1,
        transposition: 0,
        phrases: [],
        lesson: 'fallback' as const,
      },
    ]
  })
}
