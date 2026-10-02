import { CircleAlert, Ear, Mic, RotateCcw, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { saveInstrument } from '../api'
import { audioConfig } from '../audio/audioConfig'
import { listenForStrikes, recordNoiseFloor } from '../audio/mic'
import { averageTemplate } from '../audio/templates'
import { isCalibrated, type Instrument } from '../instrument'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import { cn } from '../theme/palette'
import { Button, Card, Chip } from '../ui/ui'

const cfg = audioConfig.detection

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

type Phase = 'intro' | 'noise' | 'bars' | 'saving' | 'done' | 'error'

/**
 * Calibration (spec 7.1): one second of room tone, then three strikes on
 * each bar, low to high. Each bar's averaged spectrum becomes its template.
 */
export function Calibrate({
  instrument,
  onSaved,
  onDone,
}: {
  instrument: Instrument
  onSaved: (i: Instrument) => void
  onDone: () => void
}) {
  const xylo = useRef<XylophoneHandle>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [bar, setBar] = useState(0)
  const [hits, setHits] = useState(0)
  const [message, setMessage] = useState('')
  const floor = useRef(0)
  const templates = useRef<number[][]>([])
  const spectra = useRef<Float64Array[]>([])
  const barRef = useRef(0)
  const stopMic = useRef<(() => void) | null>(null)

  const n = instrument.bars.length

  useEffect(() => () => stopMic.current?.(), [])

  useEffect(() => {
    xylo.current?.highlight(phase === 'bars' ? bar : null, null, { target: true })
  }, [phase, bar])

  const goToBar = (i: number) => {
    barRef.current = i
    spectra.current = []
    templates.current = templates.current.slice(0, i)
    setBar(i)
    setHits(0)
  }

  const onStrike = (spec: Float64Array) => {
    const i = barRef.current
    if (i >= n) return
    spectra.current.push(spec)
    setHits(spectra.current.length)
    xylo.current?.flash(i)
    if (spectra.current.length < cfg.strikesPerBar) return

    const template = averageTemplate(spectra.current)
    const label = instrument.bars[i].label
    if (spectra.current.some((s) => dot(s, template) < cfg.calibrateConsistency)) {
      setMessage(`Those ${label} strikes didn't sound alike. Let's do ${label} again.`)
      goToBar(i)
      return
    }
    const twin = templates.current.findIndex((t) => dot(t, template) > cfg.calibrateDistinct)
    if (twin >= 0) {
      setMessage(`That sounded like ${instrument.bars[twin].label}. Let's do ${label} again.`)
      goToBar(i)
      return
    }
    templates.current.push(template)
    setMessage('')
    if (i + 1 < n) goToBar(i + 1)
    else void finish()
  }

  const start = async () => {
    try {
      setMessage('')
      setPhase('noise')
      floor.current = await recordNoiseFloor()
      templates.current = []
      goToBar(0)
      setPhase('bars')
      stopMic.current = await listenForStrikes(floor.current, onStrike)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  const finish = async () => {
    stopMic.current?.()
    stopMic.current = null
    setPhase('saving')
    const calibrated: Instrument = {
      bars: instrument.bars.map((b, i) => ({ ...b, template: templates.current[i] })),
      noise_floor: floor.current,
    }
    try {
      onSaved(await saveInstrument(calibrated))
      setPhase('done')
    } catch (e) {
      setMessage(`Could not save: ${e instanceof Error ? e.message : e}. Is the local server running?`)
      setPhase('error')
    }
  }

  const cancel = () => {
    stopMic.current?.()
    stopMic.current = null
    setPhase('intro')
  }

  const current = instrument.bars[bar]

  return (
    <div className="tool">
      <Card t={1} pattern="mesh" className="stack tool-card" aria-live="polite">
        {phase === 'intro' && (
          <>
            <div className="card-head">
              <h3 className="card-title">Teach Plink her xylophone</h3>
              {isCalibrated(instrument) && <Chip t={1} solid>Learned ✓</Chip>}
            </div>
            <p className="dim">
              Plink learns the sound of <em>her</em> bars, through this laptop’s microphone in this room. Toy xylophones are rarely
              in tune, so Plink learns her instrument’s own sound instead of guessing notes. Find a quiet moment and keep
              the mallet handy. It takes under a minute.
            </p>
            <div className="row">
              <Button variant="primary" icon={<Mic aria-hidden />} onClick={start}>
                Start
              </Button>
            </div>
          </>
        )}
        {phase === 'noise' && (
          <p className="say-big display">
            <Ear aria-hidden /> Shh… listening to the room
          </p>
        )}
        {phase === 'bars' && (
          <>
            <p className="say-big display">
              Hit{' '}
              <span className="bar-name" style={{ background: current.colour }}>
                {current.label}
              </span>{' '}
              {cfg.strikesPerBar} times
            </p>
            <p className="hit-dots" aria-label={`${hits} of ${cfg.strikesPerBar}`}>
              {Array.from({ length: cfg.strikesPerBar }, (_, k) => (
                <span key={k} className={cn('hit-dot', k < hits && 'on')} style={{ background: k < hits ? current.colour : undefined }} />
              ))}
            </p>
            <ol className="bar-progress" aria-label={`Bar ${bar + 1} of ${n}`}>
              {instrument.bars.map((b, i) => (
                <li key={i} className={cn(i < bar && 'done', i === bar && 'now')} style={{ background: i <= bar ? b.colour : undefined }} />
              ))}
            </ol>
            {message && (
              <p className="alert">
                <CircleAlert aria-hidden /> {message}
              </p>
            )}
            <div className="row">
              <Button variant="secondary" size="sm" t={2} icon={<RotateCcw aria-hidden size={18} />} onClick={() => goToBar(bar)}>
                Redo this bar
              </Button>
              {bar > 0 && (
                <Button variant="secondary" size="sm" t={3} icon={<Undo2 aria-hidden size={18} />} onClick={() => goToBar(bar - 1)}>
                  Back a bar
                </Button>
              )}
              <Button variant="ghost" size="sm" t={0} icon={<X aria-hidden size={18} />} onClick={cancel}>
                Cancel
              </Button>
            </div>
          </>
        )}
        {phase === 'saving' && (
          <p className="row">
            <span className="spinner" aria-hidden /> Saving…
          </p>
        )}
        {phase === 'done' && (
          <>
            <p className="say-big display gradient-text">All {n} bars learned!</p>
            <p className="dim">Next, the mic check makes sure Plink hears every bar correctly.</p>
            <div className="row">
              <Button variant="primary" icon={<Ear aria-hidden />} onClick={onDone}>
                Run the mic check
              </Button>
              <Button variant="ghost" t={1} onClick={() => setPhase('intro')}>
                Calibrate again
              </Button>
            </div>
          </>
        )}
        {phase === 'error' && (
          <>
            <p className="alert" role="alert">
              <CircleAlert aria-hidden /> {message}
            </p>
            <div className="row">
              <Button variant="outline" t={3} onClick={() => setPhase('intro')}>
                Try again
              </Button>
            </div>
          </>
        )}
      </Card>

      <Xylophone ref={xylo} instrument={instrument} keyboard={false} showKeyCaps={false} />
    </div>
  )
}
