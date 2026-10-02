import type { Instrument } from './instrument'
import type { AttemptRow } from './play/phraseRun'
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
  session_minutes: number
  drill_target: number
  child_name: string
  home_language: string
  speech_lang: string
}

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
}

export const nextDrill = (sessionId: number, songId: string) =>
  call<Drill>(`/api/next-drill?session_id=${sessionId}&song_id=${encodeURIComponent(songId)}`)

export interface NewSong {
  title: string
  source: 'played' | 'hummed' | 'typed'
  bars: number[]
  beats: number[]
}

export const createSong = (song: NewSong) => post<ApiSong>('/api/songs', song)

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

export const getPraise = () => post<{ lines: string[]; source: string }>('/api/praise', {})

export const deleteAllData = () => call<{ deleted: boolean }>('/api/data', { method: 'DELETE' })
