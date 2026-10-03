import { createContext, useContext } from 'react'
import type { Account, Health, Settings } from '../api'
import type { Instrument } from '../instrument'

export const DEFAULT_SETTINGS: Settings = {
  child_name: '',
  home_language: 'English',
  speech_lang: '',
  session_minutes: 5,
  drill_target: 0.8,
  calm_mode: false,
  show_key_caps: true,
  help_level: 'some',
  parent_gate: true,
}

export interface AppState {
  instrument: Instrument
  setInstrument: (i: Instrument) => void
  settings: Settings
  setSettings: (s: Settings) => void
  /** null while loading or when the local server is not running. */
  health: Health | null
  serverUp: boolean
  navigate: (path: string) => void
  /** Bumped after data changes elsewhere (songs added, data deleted) so lists reload. */
  dataVersion: number
  bumpData: () => void
  /** The grown-up who is logged in; null only when the server is off and free play runs alone. */
  account: Account | null
  setAccount: (a: Account | null) => void
  logOut: () => void
}

export const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppContext')
  return ctx
}
