import { ArrowLeft, Circle, Keyboard, Mic, Play, Plus, Sparkles, Square, Trash2, Type } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildLesson, createSong } from '../api'
import { useApp } from '../app/AppContext'
import { audioConfig } from '../audio/audioConfig'
import { listenForBars } from '../audio/mic'
import { getAudioContext } from '../audio/synth'
import { isCalibrated } from '../instrument'
import { strikeBus, type BarStrike } from '../player/barStrike'
import { songToNotes } from '../player/playback'
import { ReplayControls } from '../player/ReplayControls'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import { lettersToTune, snapToBeats } from '../songs/recordTune'
import type { ApiSong } from '../songs/songs'
import { cn, tone } from '../theme/palette'
import { confetti } from '../ui/confetti'
import { Button, Card, Field, ScreenTitle, Switch } from '../ui/ui'

type Route = 'play' | 'type'
type Stage = 'compose' | 'recording' | 'saving' | 'saved'

/** Add a song (spec 7.7): play it in or type it, check it by ear, fix by tapping, then Gemma builds the lesson. */
export function AddSong() {
  const { instrument, bumpData, navigate } = useApp()
  const xylo = useRef<XylophoneHandle>(null)
  const [route, setRoute] = useState<Route>('play')
  const [stage, setStage] = useState<Stage>('compose')
  const [title, setTitle] = useState('')
  const [bars, setBars] = useState<number[]>([])
  const [beats, setBeats] = useState<number[]>([])
  const [typed, setTyped] = useState('')
  const [useMic, setUseMic] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<(ApiSong & { lesson_source: string; seconds: number }) | null>(null)
  const recorded = useRef<{ bar: number; t: number }[]>([])
  const stopMic = useRef<(() => void) | null>(null)

  const calibrated = isCalibrated(instrument)
  const notes = useMemo(() => songToNotes(bars.map((bar, i) => ({ bar, beats: beats[i] })), audioConfig.playback.bpm), [bars, beats])

  useEffect(() => () => stopMic.current?.(), [])

  const onStrike = (s: BarStrike) => {
    if (s.source === 'replay') return
    if (stage === 'recording') {
      if (useMic ? s.source === 'mic' : s.source !== 'mic') recorded.current.push({ bar: s.bar, t: s.t })
      setBars(recorded.current.map((r) => r.bar))
    } else if (selected !== null && stage === 'compose' && s.source !== 'mic') {
      setBars((b) => b.map((x, i) => (i === selected ? s.bar : x)))
      setSelected(selected + 1 < bars.length ? selected + 1 : null)
    }
  }
  const handler = useRef(onStrike)
  useEffect(() => {
    handler.current = onStrike
  })
  useEffect(() => strikeBus.subscribe((s) => handler.current(s)), [])

  const startRecording = async () => {
    getAudioContext()
    setError('')
    recorded.current = []
    setBars([])
    setBeats([])
    setSelected(null)
    if (useMic) {
      try {
        stopMic.current = await listenForBars(instrument.noise_floor!, instrument.bars.map((b) => b.template!))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return
      }
    }
    setStage('recording')
  }

  const stopRecording = () => {
    stopMic.current?.()
    stopMic.current = null
    const tune = snapToBeats(recorded.current)
    setBars(tune.bars)
    setBeats(tune.beats)
    setStage('compose')
  }

  const useTyped = () => {
    const tune = lettersToTune(typed, instrument)
    if (typeof tune === 'string') return setError(tune)
    setError('')
    setBars(tune.bars)
    setBeats(tune.beats)
  }

  const remove = (i: number) => {
    setBars((b) => b.filter((_, j) => j !== i))
    setBeats((b) => b.filter((_, j) => j !== i))
    setSelected(null)
  }

  const save = async () => {
    if (!title.trim()) return setError('Give the song a name first')
    setError('')
    setStage('saving')
    try {
      const song = await createSong({ title: title.trim(), source: route === 'play' ? 'played' : 'typed', bars, beats })
      const lesson = await buildLesson(song.id)
      setSaved(lesson)
      bumpData()
      setStage('saved')
      confetti()
    } catch (e) {
      setError(`Could not save: ${e instanceof Error ? e.message : e}. Is the local server running?`)
      setStage('compose')
    }
  }

  const reset = () => {
    setStage('compose')
    setTitle('')
    setBars([])
    setBeats([])
    setTyped('')
    setSaved(null)
  }

  if (stage === 'saved' && saved) {
    return (
      <section className="screen add-song">
        <ScreenTitle kicker="Added!" t={1} gradient>
          {saved.title}
        </ScreenTitle>
        <Card t={4} pattern="dots" className="stack">
          <p className="row dim">
            <Sparkles aria-hidden size={20} />
            {saved.lesson_source === 'gemma'
              ? `Gemma split it into ${saved.phrases.length} parts in ${saved.seconds}s.`
              : 'Gemma was not available, so it uses plain four-note parts for now.'}
          </p>
          <ol className="phrase-list">
            {saved.phrases.map((p, i) => (
              <li key={i} className={cn('phrase-item', tone(i))}>
                <span className="phrase-name">{p.nickname}</span>
                <span className="phrase-bars" aria-hidden>
                  {saved.bars.slice(p.start, p.end + 1).map((b, j) => (
                    <i key={j} style={{ background: instrument.bars[b].colour }}>
                      {instrument.bars[b].label}
                    </i>
                  ))}
                </span>
                {p.tip && <span className="faint small">{p.tip}</span>}
              </li>
            ))}
          </ol>
          <div className="row">
            <Button variant="primary" icon={<Play aria-hidden />} onClick={() => navigate(`/play/${saved.id}/go`)}>
              Practise it now
            </Button>
            <Button variant="secondary" t={1} icon={<Plus aria-hidden />} onClick={reset}>
              Add another
            </Button>
            <Button variant="ghost" t={2} onClick={() => navigate('/songs')}>
              All songs
            </Button>
          </div>
        </Card>
      </section>
    )
  }

  const hasNotes = bars.length > 0 && stage !== 'recording'

  return (
    <section className="screen add-song">
      <div className="screen-row">
        <ScreenTitle kicker="Song library" t={2}>
          Add a <span className="gradient-text">song</span>
        </ScreenTitle>
        <Button variant="ghost" t={1} icon={<ArrowLeft aria-hidden />} onClick={() => navigate('/songs')}>
          Back
        </Button>
      </div>

      <div className="setup-step">
        <h3 className="step-title ts-1">
          <span className="step-num tone-0">1</span> Name it
        </h3>
        <Field t={0} label="Song name">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Her lullaby" maxLength={80} />
        </Field>
      </div>

      <div className="setup-step">
        <h3 className="step-title ts-1">
          <span className="step-num tone-1">2</span> Put in the notes
        </h3>
        <div className="seg" role="tablist" aria-label="How">
          <Button
            variant="secondary"
            t={1}
            role="tab"
            aria-selected={route === 'play'}
            icon={<Keyboard aria-hidden />}
            onClick={() => setRoute('play')}
            disabled={stage === 'recording'}
          >
            Play it in
          </Button>
          <Button
            variant="secondary"
            t={3}
            role="tab"
            aria-selected={route === 'type'}
            icon={<Type aria-hidden />}
            onClick={() => setRoute('type')}
            disabled={stage === 'recording'}
          >
            Type it
          </Button>
        </div>

        {route === 'play' && (
          <>
            <p className="dim">
              Press record, then play the tune slowly and evenly on the bars below (or keys A S D F J K L ;). Plink keeps the
              bars and how long each note lasts.
            </p>
            {calibrated && (
              <Switch
                t={3}
                checked={useMic}
                onChange={(e) => setUseMic(e.target.checked)}
                disabled={stage === 'recording'}
                label={<><Mic aria-hidden size={18} /> Play it on her xylophone (microphone, beta)</>}
              />
            )}
          </>
        )}

        {route === 'type' && (
          <div className="row type-row">
            <input
              className="input grow tone-3"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="C C G G A A G:2"
              aria-label="Notes"
            />
            <Button variant="outline" t={3} onClick={useTyped}>
              Use these notes
            </Button>
            <p className="faint small">Letters are her bars. C′ (or C') is the high C; G:2 holds a note for two beats.</p>
          </div>
        )}

        <Xylophone ref={xylo} instrument={instrument} keyboard={!useMic || stage !== 'recording'} />

        {route === 'play' && (
          <div className="row">
            {stage === 'recording' ? (
              <Button variant="primary" size="lg" className="recording" icon={<Square aria-hidden />} onClick={stopRecording}>
                Stop · {bars.length} notes
              </Button>
            ) : (
              <Button variant="primary" size="lg" icon={<Circle aria-hidden fill="currentColor" />} onClick={startRecording}>
                {bars.length ? 'Record again' : 'Record'}
              </Button>
            )}
          </div>
        )}
      </div>

      {hasNotes && (
        <div className="setup-step">
          <h3 className="step-title ts-1">
            <span className="step-num tone-2">3</span> Check it and fix it
          </h3>
          <p className="dim">Listen back. To fix a note, tap it, then tap the right bar. Longer notes are wider.</p>
          <div className="strip" role="list" aria-label="Notes in the song">
            {bars.map((b, i) => (
              <span key={i} role="listitem" className={cn('strip-note', selected === i && 'sel')}>
                <button
                  type="button"
                  className="strip-chip"
                  style={{ background: instrument.bars[b].colour, width: `${30 + 16 * beats[i]}px` }}
                  onClick={() => setSelected(selected === i ? null : i)}
                  aria-label={`Note ${i + 1}: ${instrument.bars[b].label}, ${beats[i]} beats${selected === i ? ', selected' : ''}`}
                >
                  {instrument.bars[b].label}
                </button>
                {selected === i && (
                  <button type="button" className="strip-x" onClick={() => remove(i)} aria-label={`Delete note ${i + 1}`}>
                    <Trash2 aria-hidden size={14} />
                  </button>
                )}
              </span>
            ))}
          </div>
          <ReplayControls notes={notes} instrument={instrument} xylo={xylo} />
          <div className="row">
            <Button
              variant="primary"
              size="lg"
              icon={stage === 'saving' ? <span className="spinner" aria-hidden /> : <Sparkles aria-hidden />}
              onClick={save}
              disabled={stage === 'saving'}
            >
              {stage === 'saving' ? 'Gemma is building the lesson…' : 'Save song'}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="alert" role="alert">{error}</p>}
    </section>
  )
}
