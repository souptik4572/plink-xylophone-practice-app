import { CircleAlert, Ear, Mic, RotateCcw, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { saveInstrument } from '../api'
import { audioConfig } from '../audio/audioConfig'
import { checkBar, noteName, type BarVerdict, type LearnedBar } from '../audio/calibration'
import { listenForStrikes, recordNoiseFloor } from '../audio/mic'
import type { Sound } from '../audio/onset'
import { isCalibrated, needsRecalibration, type Instrument } from '../instrument'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import { cn } from '../theme/palette'
import { Button, Card, Chip } from '../ui/ui'

const cfg = audioConfig.detection

const IGNORED: Record<NonNullable<Sound['rejected']>, string> = {
  short: 'Plink heard a tap or a clap, not a bar, and ignored it.',
  swell: 'Plink heard a voice, not a bar, and ignored it.',
  noisy: 'Plink heard a noise, not a bar, and ignored it.',
}

type Phase = 'intro' | 'noise' | 'bars' | 'saving' | 'done' | 'error'

/**
 * Calibration (spec 7.1): one second of room tone, then three strikes on
 * each bar, low to high. Each bar's averaged spectrum becomes its template.
 * Only sounds the gate takes for a bar count, and each bar must sound higher
 * than the one before, so a stray noise or a skipped bar can't shift the rest.
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
  const [heard, setHeard] = useState<number | null>(null)
  const floor = useRef(0)
  const learned = useRef<LearnedBar[]>([])
  const strikes = useRef<Sound[]>([])
  // A big jump heard once on this bar: heard again, it is the instrument, not a skipped bar.
  const jump = useRef<{ bar: number; pitchHz: number } | null>(null)
  const barRef = useRef(0)
  const stopMic = useRef<(() => void) | null>(null)

  const n = instrument.bars.length

  useEffect(() => () => stopMic.current?.(), [])

  useEffect(() => {
    xylo.current?.highlight(phase === 'bars' ? bar : null, null, { target: true })
  }, [phase, bar])

  const goToBar = (i: number) => {
    barRef.current = i
    strikes.current = []
    learned.current = learned.current.slice(0, i)
    setBar(i)
    setHits(0)
  }

  const onStrike = (sound: Sound) => {
    const i = barRef.current
    if (i >= n) return
    strikes.current.push(sound)
    setHits(strikes.current.length)
    setHeard(sound.pitchHz)
    xylo.current?.flash(i)
    if (strikes.current.length < cfg.strikesPerBar) return

    const bars = instrument.bars
    const step = i > 0 ? bars[i].semitone_offset - bars[i - 1].semitone_offset : 0
    const trust = jump.current?.bar === i ? jump.current.pitchHz : undefined
    const verdict = checkBar(strikes.current, learned.current, step, trust)
    if (!verdict.ok) {
      if (verdict.problem === 'skipped') jump.current = { bar: i, pitchHz: verdict.pitchHz }
      setMessage(problem(verdict, i))
      goToBar(i)
      return
    }
    learned.current.push(verdict.learned)
    jump.current = null
    setMessage('')
    setHeard(null)
    if (i + 1 < n) goToBar(i + 1)
    else void finish()
  }

  const problem = (verdict: Exclude<BarVerdict, { ok: true }>, i: number) => {
    const label = instrument.bars[i].label
    switch (verdict.problem) {
      case 'mixed':
        return `Those ${label} strikes didn't sound alike. Let's do ${label} again.`
      case 'twin':
        return `That sounded like ${instrument.bars[verdict.twin].label} again. Hit ${label}, the next bar up.`
      case 'lower':
        return `That sounded lower than ${instrument.bars[i - 1].label}. Hit ${label}, the next bar up.`
      case 'skipped':
        return `That sounded higher than ${label} should, as if a bar was skipped. Hit ${label} again: if it sounds the same, Plink will trust it.`
    }
  }

  const onIgnored = (sound: Sound) => setMessage(IGNORED[sound.rejected!])

  const start = async () => {
    try {
      setMessage('')
      setPhase('noise')
      floor.current = await recordNoiseFloor()
      learned.current = []
      jump.current = null
      setHeard(null)
      goToBar(0)
      setPhase('bars')
      stopMic.current = await listenForStrikes(floor.current, onStrike, onIgnored)
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
      bars: instrument.bars.map((b, i) => ({ ...b, template: learned.current[i].template })),
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
            {needsRecalibration(instrument) && (
              <p className="alert">
                <CircleAlert aria-hidden /> Plink listens in a new way now, so it needs to learn her bars once more.
              </p>
            )}
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
            {heard && (
              <p className="faint small">
                Last strike: about {noteName(heard)} ({Math.round(heard)} Hz)
              </p>
            )}
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
