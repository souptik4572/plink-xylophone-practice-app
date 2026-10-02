import { useMemo, useRef, useState } from 'react'
import { audioConfig } from '../audio/audioConfig'
import type { Instrument } from '../instrument'
import { songToNotes } from '../player/playback'
import { ReplayControls } from '../player/ReplayControls'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import builtin from '../songs/builtin.json'
import { parseNotes, toDefaultBars, type SongDef } from '../songs/notation'

/** The built-in tunes that fit this instrument without the fitter. */
function playableSongs(instrument: Instrument) {
  return (builtin as SongDef[]).flatMap((s) => {
    const bars = toDefaultBars(parseNotes(s.notes), instrument)
    return bars ? [{ ...s, replay: songToNotes(bars, audioConfig.playback.bpm) }] : []
  })
}

export function FreePlay({ instrument }: { instrument: Instrument }) {
  const xylo = useRef<XylophoneHandle>(null)
  const [showKeys, setShowKeys] = useState(true)
  const songs = useMemo(() => playableSongs(instrument), [instrument])
  const [songId, setSongId] = useState(songs.find((s) => s.id === 'twinkle')?.id ?? songs[0]?.id)
  const song = songs.find((s) => s.id === songId)

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
        <label className="song-pick">
          Listen to
          <select
            value={songId}
            onChange={(e) => {
              setSongId(e.target.value)
              e.target.blur() // hand the home-row keys back to the xylophone
            }}
          >
            {songs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        {song && <ReplayControls notes={song.replay} instrument={instrument} xylo={xylo} />}
      </div>
    </section>
  )
}
