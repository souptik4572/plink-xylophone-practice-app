import { Footprints, Pause, Play, Repeat, RotateCcw, SkipForward } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { audioConfig } from '../audio/audioConfig'
import { audioNow, getAudioContext, playTone } from '../audio/synth'
import { barFrequency, type Instrument } from '../instrument'
import { strikeBus } from './barStrike'
import { isTextEntry } from './keymap'
import { PlaybackDriver, type PlaybackStatus, type ReplayNote } from './playback'
import type { XylophoneHandle } from './Xylophone'
import { Button } from '../ui/ui'

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
    <div className="deck" role="group" aria-label="Replay">
      <Button
        variant="primary"
        size="lg"
        className="deck-play"
        onClick={toggle}
        disabled={stepMode}
        aria-keyshortcuts="Space"
        icon={playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      >
        {playing ? 'Pause' : 'Play'}
      </Button>
      <Button variant="outline" t={1} iconOnly icon={<RotateCcw aria-hidden />} onClick={restart} disabled={stepMode}>
        Restart
      </Button>
      <Button
        variant="secondary"
        t={2}
        size="sm"
        icon={<Repeat aria-hidden size={18} />}
        aria-pressed={loop}
        onClick={() => {
          setLoop(!loop)
          driver.current?.engine.setLoop(!loop)
        }}
      >
        Loop
      </Button>
      <div className="seg" role="group" aria-label="Speed">
        {audioConfig.playback.tempos.map((t, i) => (
          <Button
            key={t}
            variant="secondary"
            size="sm"
            t={i + 3}
            aria-pressed={tempo === t}
            onClick={() => {
              setTempo(t)
              driver.current?.engine.setTempo(t)
            }}
          >
            {t === 1 ? 'Normal' : t === 0.5 ? 'Slow' : 'Medium'}
          </Button>
        ))}
      </div>
      <Button
        variant="secondary"
        t={0}
        size="sm"
        icon={<Footprints aria-hidden size={18} />}
        aria-pressed={stepMode}
        onClick={() => {
          setStepMode(!stepMode)
          if (!stepMode) driver.current?.engine.pause()
        }}
      >
        One at a time
      </Button>
      {stepMode && (
        <Button variant="outline" t={4} onClick={step} aria-keyshortcuts="Enter" icon={<SkipForward aria-hidden />}>
          Next note
        </Button>
      )}
    </div>
  )
}
