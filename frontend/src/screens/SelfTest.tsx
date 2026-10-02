import { useEffect, useRef, useState } from 'react'
import { audioConfig } from '../audio/audioConfig'
import { listenForStrikes } from '../audio/mic'
import { confusionGrid, matchSpectrum, type Match } from '../audio/matcher'
import { isCalibrated, type Instrument } from '../instrument'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'

const cfg = audioConfig.detection

interface Trial {
  expected: number
  got: number | null
}

/** Self-test (spec 7.2): each bar struck five times, shown as a confusion grid. Gate: 36 of 40. */
export function SelfTest({ instrument }: { instrument: Instrument }) {
  const xylo = useRef<XylophoneHandle>(null)
  const [trials, setTrials] = useState<Trial[]>([])
  const [running, setRunning] = useState(false)
  const [last, setLast] = useState<Match | null>(null)
  const [error, setError] = useState('')
  const stopMic = useRef<(() => void) | null>(null)
  const count = useRef(0)

  const n = instrument.bars.length
  const total = n * cfg.selfTestStrikesPerBar
  const gate = Math.ceil((total * cfg.selfTestGate) / 40)
  const target = Math.floor(trials.length / cfg.selfTestStrikesPerBar)
  const finished = trials.length >= total

  useEffect(() => () => stopMic.current?.(), [])

  useEffect(() => {
    xylo.current?.highlight(running && !finished ? target : null, null)
  }, [running, finished, target])

  const stop = () => {
    stopMic.current?.()
    stopMic.current = null
    setRunning(false)
  }

  useEffect(() => {
    if (finished) stop()
  }, [finished])

  const start = async () => {
    setTrials([])
    setLast(null)
    setError('')
    count.current = 0
    try {
      const templates = instrument.bars.map((b) => b.template!)
      stopMic.current = await listenForStrikes(instrument.noise_floor!, (spec) => {
        if (count.current >= total) return
        const expected = Math.floor(count.current / cfg.selfTestStrikesPerBar)
        count.current++
        const m = matchSpectrum(spec, templates)
        if (m.bar !== null) xylo.current?.flash(m.bar)
        setLast(m)
        setTrials((t) => [...t, { expected, got: m.bar }])
      })
      setRunning(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!isCalibrated(instrument)) {
    return (
      <section className="screen">
        <h2>Self-test</h2>
        <div className="panel">
          <p>Calibrate the xylophone first.</p>
        </div>
      </section>
    )
  }

  const { grid, correct } = confusionGrid(trials, n)
  const passed = correct >= gate

  return (
    <section className="screen">
      <div className="screen-head">
        <h2>Self-test</h2>
        <span className="muted">
          Pass: {gate} of {total} correct
        </span>
      </div>

      <Xylophone ref={xylo} instrument={instrument} keyboard={false} showKeyCaps={false} />

      <div className="panel prompt">
        {!running && !finished && (
          <>
            <p>
              Hit each bar {cfg.selfTestStrikesPerBar} times when it glows, low to high. Unsure strikes count as
              misses.
            </p>
            <button type="button" className="primary" onClick={start}>
              Start self-test
            </button>
          </>
        )}
        {running && !finished && (
          <>
            <p className="say">
              Hit <strong style={{ color: instrument.bars[target].colour }}>{instrument.bars[target].label}</strong>{' '}
              ({(trials.length % cfg.selfTestStrikesPerBar) + 1} of {cfg.selfTestStrikesPerBar})
            </p>
            <button type="button" onClick={stop}>
              Stop
            </button>
          </>
        )}
        {finished && (
          <>
            <p className={`say ${passed ? 'pass' : 'fail'}`}>
              {correct} of {total} correct: {passed ? 'passed' : 'below the gate'}
            </p>
            {!passed && (
              <p>
                Try calibrating again somewhere quieter, with the laptop closer. If it still misses, use the on-screen
                xylophone and treat the microphone as beta.
              </p>
            )}
            <button type="button" onClick={start}>
              Run again
            </button>
          </>
        )}
        {last && (
          <p className="muted">
            Last strike: {last.bar === null ? 'unsure' : instrument.bars[last.bar].label} · score{' '}
            {last.score.toFixed(2)} · margin {last.margin.toFixed(2)}
          </p>
        )}
        {error && <p className="warn">{error}</p>}
      </div>

      {trials.length > 0 && (
        <div className="panel">
          <table className="confusion">
            <caption>Rows: bar asked for. Columns: bar heard.</caption>
            <thead>
              <tr>
                <th />
                {instrument.bars.map((b, i) => (
                  <th key={i} scope="col">
                    {b.label}
                  </th>
                ))}
                <th scope="col">?</th>
              </tr>
            </thead>
            <tbody>
              {grid.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{instrument.bars[i].label}</th>
                  {row.map((v, j) => (
                    <td key={j} className={v === 0 ? '' : i === j ? 'hit' : 'miss'}>
                      {v || ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
