import type { Instrument } from './instrument'
import type { AttemptRow } from './play/phraseRun'
import type { ToolUse } from './kids/answer'
import type { HelpAdvice } from './kids/help'
import type { ApiSong } from './songs/songs'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${r.status}`)
  return r.json() as Promise<T>
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) })

export interface Health {
  ok: boolean
  ollama: boolean
  gemma_model: string
  tabpfn: boolean
}

export interface Settings {
  child_name: string
  home_language: string
  speech_lang: string
  session_minutes: number
  drill_target: number
  calm_mode: boolean
  show_key_caps: boolean
  help_level: 'lots' | 'some' | 'little'
  parent_gate: boolean
}

export const getSettings = () => call<Settings>('/api/settings')

export const saveSettings = (s: Partial<Settings>) =>
  call<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) })

export const getHealth = () => call<Health>('/api/health')

/** The saved instrument, or null before the first calibration. */
export async function loadInstrument(): Promise<Instrument | null> {
  try {
    return await call<Instrument>('/api/instrument')
  } catch {
    return null
  }
}

export const saveInstrument = (inst: Instrument) =>
  call<Instrument>('/api/instrument', { method: 'PUT', body: JSON.stringify(inst) })

export const listSongs = () => call<ApiSong[]>('/api/songs')

export const startSession = (player: 'child' | 'tester') =>
  post<{ id: number; player: string; started_at: string }>('/api/sessions', { player })

export const postAttempts = (rows: AttemptRow[]) => post<{ inserted: number }>('/api/attempts', { rows })

export interface Drill {
  song_id: string
  phrase_idx: number
  source: 'tabpfn' | 'fallback'
  expected_success: number | null
  note_probs: number[] | null
  rows_used: number
}

export const nextDrill = (sessionId: number, songId: string) =>
  call<Drill>(`/api/next-drill?session_id=${sessionId}&song_id=${encodeURIComponent(songId)}`)

export interface NewSong {
  title: string
  source: 'played' | 'hummed' | 'typed' | 'photo'
  bars: number[]
  beats: number[]
}

export const createSong = (song: NewSong) => post<ApiSong>('/api/songs', song)

export interface Fit {
  bars: number[]
  beats: number[]
  misfits: number[]
  fit_score: number
  transposition: number
}

export interface CardReading {
  title: string
  bars: number[]
  beats: number[]
  /** Notes where the printed symbol and the colour disagreed: worth a look. */
  flagged: number[]
  unreadable: number
  counts: number[]
  seconds: number
}

/** Gemma 4 vision reads a photo of a song card (sent only to this laptop's server, never stored). */
export const readCard = (image: string) => post<CardReading>('/api/songs/read-card', { image })

/** Place note names (any key) on her bars: the transposing fitter, spec 7.6. */
export const fitNotes = (notes: string) => post<Fit>('/api/songs/fit', { notes })

export const buildLesson = (songId: string, lyric = '') =>
  post<ApiSong & { lesson_source: 'gemma' | 'fallback'; seconds: number }>(
    `/api/songs/${encodeURIComponent(songId)}/lesson`,
    { lyric },
  )

export interface SessionStats {
  phrases: number
  notes: number
  first_try_pct: number
  replays: number
  minutes: number
  avg_response_ms: number
}

export interface WeakJump {
  from: string
  to: string
  expected: number
  source: 'tabpfn' | 'observed'
}

export interface ParentNote {
  note: string
  source: 'gemma' | 'fallback'
  seconds: number
  stats: SessionStats
  weakest_jumps: WeakJump[]
}

export const writeParentNote = (sessionId: number) => post<ParentNote>(`/api/sessions/${sessionId}/parent-note`, {})

export interface SessionSummary {
  id: number
  player: string
  started_at: string
  stats: SessionStats
  parent_note: string | null
}

export const listSessions = () => call<SessionSummary[]>('/api/sessions')

export interface Progress {
  sessions: number
  notes: number
  stars: number
  first_try_pct: number
  practice_days: number
  streak_days: number
  weakest_jumps: WeakJump[]
}

export const getProgress = () => call<Progress>('/api/progress')

export const getPraise = () => post<{ lines: string[]; source: string }>('/api/praise', {})

export const deleteAllData = () => call<{ deleted: boolean }>('/api/data', { method: 'DELETE' })

type Level = 'lots' | 'some' | 'little'

export interface Insights {
  source: 'tabpfn' | 'fallback'
  rows_used: number
  seconds?: number
  songs: { song_id: string; by_level: Record<Level, number>; help: HelpAdvice }[]
  rows_by_level?: Record<Level, number>
  known_levels?: Level[]
  help: (HelpAdvice & { basis_song: string }) | null
}

export const getInsights = () => call<Insights>('/api/insights')

export interface AskReply {
  answer: string
  tools: ToolUse[]
  seconds: number
}

/** A grown-up's question to Gemma, which answers by calling tools over her data and TabPFN. */
export const askPlink = (question: string, history: { role: 'user' | 'assistant'; content: string }[]) =>
  post<AskReply>('/api/ask', { question, history })
