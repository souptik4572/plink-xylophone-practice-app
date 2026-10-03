import { CircleAlert, Ear, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { audioConfig } from '../audio/audioConfig'
import { listenForStrikes } from '../audio/mic'
import { confusionGrid, matchSpectrum, type Match } from '../audio/matcher'
import { isCalibrated, type Instrument } from '../instrument'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import { cn } from '../theme/palette'
import { Button, Card, Chip } from '../ui/ui'

const cfg = audioConfig.detection

interface Trial {
  expected: number
  got: number | null
}

/** Self-test (spec 7.2): each bar struck five times, shown as a confusion grid. Gate: 36 of 40. */
export function SelfTest({ instrument, onCalibrate }: { instrument: Instrument; onCalibrate: () => void }) {
  const xylo = useRef<XylophoneHandle>(null)
  const [trials, setTrials] = useState<Trial[]>([])
  const [running, setRunning] = useState(false)
  const [last, setLast] = useState<Match | null>(null)
  const [ignored, setIgnored] = useState(0)
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
    xylo.current?.highlight(running && !finished ? target : null, null, { target: true })
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
    setIgnored(0)
    setError('')
    count.current = 0
    try {
      const templates = instrument.bars.map((b) => b.template!)
      stopMic.current = await listenForStrikes(
        instrument.noise_floor!,
        (sound) => {
          if (count.current >= total) return
          const expected = Math.floor(count.current / cfg.selfTestStrikesPerBar)
          count.current++
          const m = matchSpectrum(sound.features, templates)
          if (m.bar !== null) xylo.current?.flash(m.bar)
          setLast(m)
          setTrials((t) => [...t, { expected, got: m.bar }])
        },
        // A clap or a voice isn't a strike: it neither counts nor uses up a turn.
        () => setIgnored((k) => k + 1),
      )
      setRunning(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!isCalibrated(instrument)) {
    return (
      <Card t={3} border="dashed" pattern="stripes" className="stack tool-card">
        <h3 className="card-title">Mic check</h3>
        <p className="dim">Teach Plink her xylophone first. Then this checks that it hears every bar correctly.</p>
        <div className="row">
          <Button variant="primary" icon={<Ear aria-hidden />} onClick={onCalibrate}>
            Calibrate
          </Button>
        </div>
      </Card>
    )
  }

  const { grid, correct } = confusionGrid(trials, n)
  const passed = correct >= gate

  return (
    <div className="tool">
      <Card t={0} pattern="mesh" className="stack tool-card" aria-live="polite">
        <div className="card-head">
          <h3 className="card-title">Mic check</h3>
          <Chip t={2}>
            Pass: {gate} of {total}
          </Chip>
        </div>
        {!running && !finished && (
          <>
            <p className="dim">
              Hit each glowing bar {cfg.selfTestStrikesPerBar} times, low to high. Strikes Plink isn’t sure about count as misses.
              If it passes, her real xylophone can be the main way to play.
            </p>
            <div className="row">
              <Button variant="primary" icon={<Ear aria-hidden />} onClick={start}>
                Start the check
              </Button>
            </div>
          </>
        )}
        {running && !finished && (
          <>
            <p className="say-big display">
              Hit{' '}
              <span className="bar-name" style={{ background: instrument.bars[target].colour }}>
                {instrument.bars[target].label}
              </span>{' '}
              · {(trials.length % cfg.selfTestStrikesPerBar) + 1} of {cfg.selfTestStrikesPerBar}
            </p>
            <div className="row">
              <Button variant="ghost" size="sm" t={3} icon={<Square aria-hidden size={18} />} onClick={stop}>
                Stop
              </Button>
            </div>
          </>
        )}
        {finished && (
          <>
            <p className={cn('say-big display', passed ? 'gradient-text' : 'fail-text')}>
              {correct} of {total}: {passed ? 'passed!' : 'not yet'}
            </p>
            {!passed && (
              <p className="dim">
                Try calibrating again somewhere quieter, with the laptop closer. If it still misses, keep playing on screen: the
                microphone stays beta.
              </p>
            )}
            <div className="row">
              <Button variant="outline" t={1} onClick={start}>
                Run again
              </Button>
            </div>
          </>
        )}
        {last && (
          <p className="faint small">
            Last strike: {last.bar === null ? 'unsure' : instrument.bars[last.bar].label} · match {last.score.toFixed(2)} · lead{' '}
            {last.margin.toFixed(2)}
          </p>
        )}
        {ignored > 0 && (
          <p className="faint small">
            Ignored {ignored} {ignored === 1 ? 'sound' : 'sounds'} that weren’t bars (claps, taps, voices).
          </p>
        )}
        {error && (
          <p className="alert" role="alert">
            <CircleAlert aria-hidden /> {error}
          </p>
        )}
      </Card>

      <Xylophone ref={xylo} instrument={instrument} keyboard={false} showKeyCaps={false} />

      {trials.length > 0 && (
        <Card t={4} className="grid-card" border="dashed">
          <table className="confusion">
            <caption className="faint small">Rows: the bar asked for. Columns: the bar Plink heard.</caption>
            <thead>
              <tr>
                <th />
                {instrument.bars.map((b, i) => (
                  <th key={i} scope="col" style={{ color: b.colour }}>
                    {b.label}
                  </th>
                ))}
                <th scope="col">?</th>
              </tr>
            </thead>
            <tbody>
              {grid.map((row, i) => (
                <tr key={i}>
                  <th scope="row" style={{ color: instrument.bars[i].colour }}>
                    {instrument.bars[i].label}
                  </th>
                  {row.map((v, j) => (
                    <td key={j} className={v === 0 ? '' : i === j ? 'hit' : 'miss'}>
                      {v || ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
