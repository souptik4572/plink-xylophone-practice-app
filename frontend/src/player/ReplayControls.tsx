import { useEffect, useRef, useState, type RefObject } from 'react'
import { audioConfig } from '../audio/audioConfig'
import { audioNow, getAudioContext, playTone } from '../audio/synth'
import { barFrequency, type Instrument } from '../instrument'
import { strikeBus } from './barStrike'
import { isTextEntry } from './keymap'
import { PlaybackDriver, type PlaybackStatus, type ReplayNote } from './playback'
import type { XylophoneHandle } from './Xylophone'

interface Props {
  notes: ReplayNote[]
  instrument: Instrument
  xylo: RefObject<XylophoneHandle | null>
  /** Space plays or pauses, Enter steps. Turn off when another control owns those keys. */
  shortcuts?: boolean
}

/**
 * Play, pause, restart, loop, tempo and step mode for one list of notes,
 * lighting bars and key caps on the given xylophone as each note sounds.
 */
export function ReplayControls({ notes, instrument, xylo, shortcuts = true }: Props) {
  const driver = useRef<PlaybackDriver | null>(null)
  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [tempo, setTempo] = useState(1)
  const [loop, setLoop] = useState(false)
  const [stepMode, setStepMode] = useState(false)

  useEffect(() => {
    const d = new PlaybackDriver(
      notes,
      {
        now: audioNow,
        sound: (bar, when) => playTone(barFrequency(instrument, bar), when),
        onNote: (n) => strikeBus.emit({ bar: n.bar, source: 'replay', t: performance.now() }),
      },
      (h, s) => {
        const lit = h.current === null ? null : notes[h.current]
        xylo.current?.highlight(lit?.bar ?? null, h.next === null ? null : notes[h.next].bar, {
          muted: lit?.muted,
          misfit: lit?.misfit,
        })
        setStatus(s)
      },
    )
    driver.current = d
    return () => {
      d.dispose()
      xylo.current?.highlight(null, null)
      setStatus('idle')
    }
  }, [notes, instrument, xylo])

  // Each control is a user gesture, so it may create or resume the AudioContext.
  const withAudio = (fn: (e: PlaybackDriver['engine']) => void) => () => {
    getAudioContext()
    if (driver.current) fn(driver.current.engine)
  }
  const toggle = withAudio((e) => e.toggle())
  const step = withAudio((e) => e.step())
  const restart = withAudio((e) => e.restart())

  useEffect(() => {
    if (!shortcuts) return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTextEntry(e.target)) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.code === 'Enter' && stepMode) {
        e.preventDefault()
        step()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcuts, stepMode])

  const playing = status === 'playing'
  return (
    <div className="replay" role="group" aria-label="Replay">
      <button type="button" className="big" onClick={toggle} disabled={stepMode} aria-keyshortcuts="Space">
        {playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <button type="button" onClick={restart} disabled={stepMode}>
        ⟲ Restart
      </button>
      <label className="toggle">
        <input
          type="checkbox"
          checked={loop}
          onChange={(e) => {
            setLoop(e.target.checked)
            driver.current?.engine.setLoop(e.target.checked)
          }}
        />
        Loop
      </label>
      <div className="seg" role="radiogroup" aria-label="Tempo">
        {audioConfig.playback.tempos.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tempo === t}
            className={tempo === t ? 'on' : ''}
            onClick={() => {
              setTempo(t)
              driver.current?.engine.setTempo(t)
            }}
          >
            {t}×
          </button>
        ))}
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={stepMode}
          onChange={(e) => {
            setStepMode(e.target.checked)
            if (e.target.checked) driver.current?.engine.pause()
          }}
        />
        Step
      </label>
      {stepMode && (
        <button type="button" className="big" onClick={step} aria-keyshortcuts="Enter">
          Next note ⏎
        </button>
      )}
    </div>
  )
}
