import { useEffect, useRef, useState } from 'react'
import { saveInstrument } from '../api'
import { audioConfig } from '../audio/audioConfig'
import { listenForStrikes, recordNoiseFloor } from '../audio/mic'
import { averageTemplate } from '../audio/templates'
import type { Instrument } from '../instrument'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'

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
export function Calibrate({ instrument, onSaved }: { instrument: Instrument; onSaved: (i: Instrument) => void }) {
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
    xylo.current?.highlight(phase === 'bars' ? bar : null, null)
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

  return (
    <section className="screen">
      <div className="screen-head">
        <h2>Calibrate her xylophone</h2>
      </div>

      <Xylophone ref={xylo} instrument={instrument} keyboard={false} showKeyCaps={false} />

      <div className="panel prompt">
        {phase === 'intro' && (
          <>
            <p>
              Plink learns the sound of <em>her</em> bars. Find a quiet moment, put the laptop near the
              xylophone, and keep the mallet handy. It takes under a minute.
            </p>
            <button type="button" className="primary" onClick={start}>
              Start
            </button>
          </>
        )}
        {phase === 'noise' && <p className="say">Shh… listening to the room</p>}
        {phase === 'bars' && (
          <>
            <p className="say">
              Hit <strong style={{ color: instrument.bars[bar].colour }}>{instrument.bars[bar].label}</strong>{' '}
              {cfg.strikesPerBar} times
            </p>
            <p className="dots" aria-label={`${hits} of ${cfg.strikesPerBar}`}>
              {Array.from({ length: cfg.strikesPerBar }, (_, k) => (k < hits ? '●' : '○')).join(' ')}
            </p>
            <p className="muted">
              Bar {bar + 1} of {n}
            </p>
            <div className="row">
              <button type="button" onClick={() => goToBar(bar)}>
                Redo this bar
              </button>
              {bar > 0 && (
                <button type="button" onClick={() => goToBar(bar - 1)}>
                  Back a bar
                </button>
              )}
              <button type="button" onClick={cancel}>
                Cancel
              </button>
            </div>
          </>
        )}
        {phase === 'saving' && <p>Saving…</p>}
        {phase === 'done' && (
          <>
            <p className="say">All {n} bars learned.</p>
            <p>Next, run the self-test to check Plink hears every bar correctly.</p>
            <button type="button" onClick={() => setPhase('intro')}>
              Calibrate again
            </button>
          </>
        )}
        {phase === 'error' && (
          <>
            <p>{message}</p>
            <button type="button" onClick={() => setPhase('intro')}>
              Try again
            </button>
          </>
        )}
        {message && phase === 'bars' && <p className="warn">{message}</p>}
      </div>
    </section>
  )
}
