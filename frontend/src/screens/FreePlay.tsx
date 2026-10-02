import { Headphones, Info, Keyboard } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useApp } from '../app/AppContext'
import { useSongs } from '../app/useSongs'
import { ReplayControls } from '../player/ReplayControls'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import { replayNotes } from '../songs/songs'
import { cn, tone } from '../theme/palette'
import { Deco } from '../ui/Deco'
import { Card, ScreenTitle, Switch } from '../ui/ui'

/** Her instrument to play freely, and any tune or part of one replayed with bars lighting in time. */
export function FreePlay({ songId: initialSong }: { songId?: string }) {
  const { instrument, settings } = useApp()
  const { songs } = useSongs()
  const xylo = useRef<XylophoneHandle>(null)
  const [showKeys, setShowKeys] = useState(settings.show_key_caps)
  const [songId, setSongId] = useState(initialSong ?? 'twinkle')
  const [phraseIdx, setPhraseIdx] = useState(-1)

  const song = songs?.find((s) => s.id === songId) ?? songs?.[0]
  const phrase = phraseIdx >= 0 ? song?.phrases[phraseIdx] : undefined
  const notes = useMemo(() => (song ? replayNotes(song, phrase) : []), [song, phrase])

  return (
    <section className="screen free">
      <Deco
        items={[
          { shape: 'note', at: { top: '0%', right: '28%' }, size: 44, t: 1, motion: 'float', wide: true },
          { shape: 'sparkle', at: { top: '0%', left: '44%' }, size: 34, t: 2, motion: 'spin-slow', wide: true },
          { emoji: '🥁', at: { top: '2%', left: '58%' }, size: 34, t: 0, motion: 'wiggle', wide: true },
        ]}
      />
      <div className="screen-row">
        <ScreenTitle kicker="Free play" t={3}>
          Jam <span className="gradient-text">time</span>
        </ScreenTitle>
        <Switch t={2} checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} label={<><Keyboard aria-hidden size={18} /> Show keys</>} />
      </div>

      <Xylophone ref={xylo} instrument={instrument} showKeyCaps={showKeys} />

      {song && (
        <Card t={1} pattern="checker" className="listen stack">
          <div className="card-head">
            <span className="label">
              <Headphones aria-hidden size={16} /> Listen and watch
            </span>
          </div>
          <div className="chip-row" role="group" aria-label="Song">
            {songs?.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === song.id}
                className={cn('btn btn-secondary btn-sm', tone(i))}
                onClick={(e) => {
                  setSongId(s.id)
                  setPhraseIdx(-1)
                  e.currentTarget.blur() // hand the home-row keys back to the xylophone
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
          {song.phrases.length > 0 && (
            <div className="chip-row" role="group" aria-label="Part">
              <span className="faint small">Part:</span>
              {[{ nickname: 'Whole song' }, ...song.phrases].map((p, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={phraseIdx === i - 1}
                  className={cn('btn btn-ghost btn-sm', tone(i + 2))}
                  onClick={(e) => {
                    setPhraseIdx(i - 1)
                    e.currentTarget.blur()
                  }}
                >
                  {p.nickname}
                </button>
              ))}
            </div>
          )}
          {song.misfits.length > 0 && (
            <p className="row small dim">
              <Info aria-hidden size={18} /> Almost fits: {song.misfits.length} note{song.misfits.length > 1 ? 's' : ''} need a bar she
              doesn’t have, so they play on the nearest one (marked ≈).
            </p>
          )}
          <ReplayControls notes={notes} instrument={instrument} xylo={xylo} />
        </Card>
      )}
    </section>
  )
}
