import { useEffect, useState } from 'react'
import { listSongs } from '../api'
import { offlineSongs, type ApiSong } from '../songs/songs'
import { useApp } from './AppContext'

/**
 * The song library. `offline` is true when the server is down and only the
 * built-ins that fit as written are available, without lessons.
 */
export function useSongs() {
  const { instrument, dataVersion } = useApp()
  const [songs, setSongs] = useState<ApiSong[] | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let live = true
    listSongs()
      .then((s) => {
        if (!live) return
        setSongs(s)
        setOffline(false)
      })
      .catch(() => {
        if (!live) return
        setSongs(offlineSongs(instrument))
        setOffline(true)
      })
    return () => {
      live = false
    }
  }, [instrument, dataVersion])

  return { songs, offline, setSongs }
}

const LAST_SONG = 'plink.lastSong'

/** The song she played last, remembered in this browser for the one-tap start. */
export function lastSongId(): string {
  try {
    return localStorage.getItem(LAST_SONG) ?? 'twinkle'
  } catch {
    return 'twinkle'
  }
}

export function rememberSong(id: string) {
  try {
    localStorage.setItem(LAST_SONG, id)
  } catch {
    // Private mode or storage blocked: the default song is fine.
  }
}
