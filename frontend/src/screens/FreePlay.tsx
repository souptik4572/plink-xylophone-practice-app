import { useEffect, useMemo, useRef, useState } from 'react'
import { listSongs } from '../api'
import type { Instrument } from '../instrument'
import { ReplayControls } from '../player/ReplayControls'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import { offlineSongs, replayNotes, type ApiSong } from '../songs/songs'

/** Her instrument to play freely, plus the song library: any tune or phrase replays with bars lighting. */
export function FreePlay({ instrument }: { instrument: Instrument }) {
  const xylo = useRef<XylophoneHandle>(null)
  const [showKeys, setShowKeys] = useState(true)
  const [songs, setSongs] = useState<ApiSong[]>(() => offlineSongs(instrument))
  const [songId, setSongId] = useState('twinkle')
  const [phraseIdx, setPhraseIdx] = useState(-1)

  useEffect(() => {
    listSongs()
      .then(setSongs)
      .catch(() => {}) // server down: the offline built-ins still play
  }, [])

  const song = songs.find((s) => s.id === songId) ?? songs[0]
  const phrase = phraseIdx >= 0 ? song?.phrases[phraseIdx] : undefined
  const notes = useMemo(() => (song ? replayNotes(song, phrase) : []), [song, phrase])

  // Hand the home-row keys back to the xylophone after picking from a list.
  const pick = (fn: () => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    fn()
    e.target.blur()
  }

  return (
    <section className="screen">
      <div className="screen-head">
        <h2>Free play</h2>
        <label className="toggle">
          <input type="checkbox" checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} />
          Show keys
        </label>
      </div>

      <Xylophone ref={xylo} instrument={instrument} showKeyCaps={showKeys} />

      <div className="panel">
        <div className="row">
          <label className="song-pick">
            Listen to
            <select
              value={song?.id}
              onChange={(e) =>
                pick(() => {
                  setSongId(e.target.value)
                  setPhraseIdx(-1)
                })(e)
              }
            >
              {songs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          {song && song.phrases.length > 0 && (
            <label className="song-pick">
              Part
              <select value={phraseIdx} onChange={(e) => pick(() => setPhraseIdx(Number(e.target.value)))(e)}>
                <option value={-1}>Whole song</option>
                {song.phrases.map((p, i) => (
                  <option key={i} value={i}>
                    {p.nickname}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {song && song.misfits.length > 0 && (
          <p className="muted">
            Almost fits: {song.misfits.length} note{song.misfits.length > 1 ? 's' : ''} need a bar she doesn't have,
            so they play on the nearest one (marked ≈).
          </p>
        )}
        {song && <ReplayControls notes={notes} instrument={instrument} xylo={xylo} />}
      </div>
    </section>
  )
}
