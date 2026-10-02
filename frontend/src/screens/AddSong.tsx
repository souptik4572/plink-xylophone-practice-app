import { useEffect, useMemo, useRef, useState } from 'react'
import { buildLesson, createSong } from '../api'
import { audioConfig } from '../audio/audioConfig'
import { listenForBars } from '../audio/mic'
import { getAudioContext } from '../audio/synth'
import { isCalibrated, type Instrument } from '../instrument'
import { strikeBus, type BarStrike } from '../player/barStrike'
import { songToNotes } from '../player/playback'
import { ReplayControls } from '../player/ReplayControls'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import { lettersToTune, snapToBeats } from '../songs/recordTune'
import type { ApiSong } from '../songs/songs'

type Route = 'play' | 'type'
type Stage = 'compose' | 'recording' | 'saving' | 'saved'

/** Add a song (spec 7.7): play it in or type it, check it by ear, fix by tapping, then Gemma builds the lesson. */
export function AddSong({ instrument, onAdded }: { instrument: Instrument; onAdded: (s: ApiSong) => void }) {
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
      onAdded(lesson)
      setStage('saved')
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
      <section className="screen">
        <h2>Added “{saved.title}”</h2>
        <div className="panel">
          <p className="muted">
            {saved.lesson_source === 'gemma'
              ? `Gemma split it into ${saved.phrases.length} phrases in ${saved.seconds}s.`
              : 'Gemma was not available, so it uses plain four-note phrases for now.'}
          </p>
          <ol className="phrase-list">
            {saved.phrases.map((p, i) => (
              <li key={i}>
                <strong>{p.nickname}</strong>
                <span className="phrase-bars">
                  {saved.bars.slice(p.start, p.end + 1).map((b, j) => (
                    <span key={j} className="chip" style={{ background: instrument.bars[b].colour }}>
                      {instrument.bars[b].label}
                    </span>
                  ))}
                </span>
                {p.tip && <span className="muted"> {p.tip}</span>}
              </li>
            ))}
          </ol>
          <div className="row">
            <button type="button" onClick={reset}>
              Add another
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="screen">
      <div className="screen-head">
        <h2>Add a song</h2>
      </div>

      <Xylophone ref={xylo} instrument={instrument} keyboard={!useMic || stage !== 'recording'} />

      <div className="panel">
        <label className="field">
          Name
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Her lullaby" maxLength={80} />
        </label>

        <div className="subnav" role="tablist">
          {(['play', 'type'] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={route === r}
              className={route === r ? 'on' : ''}
              onClick={() => setRoute(r)}
              disabled={stage === 'recording'}
            >
              {r === 'play' ? 'Play it in' : 'Type it'}
            </button>
          ))}
        </div>

        {route === 'play' && (
          <>
            <p className="muted">
              Play the tune slowly and evenly. Plink keeps the bars and how long each note lasts, to the nearest half
              beat.
            </p>
            {calibrated && (
              <label className="toggle">
                <input type="checkbox" checked={useMic} onChange={(e) => setUseMic(e.target.checked)} disabled={stage === 'recording'} />
                Play it on her xylophone (microphone, beta)
              </label>
            )}
            <div className="row">
              {stage === 'recording' ? (
                <button type="button" className="primary" onClick={stopRecording}>
                  ■ Stop ({bars.length} notes)
                </button>
              ) : (
                <button type="button" className="primary" onClick={startRecording}>
                  ● Record
                </button>
              )}
            </div>
          </>
        )}

        {route === 'type' && (
          <div className="row">
            <input
              className="grow"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="C C G G A A G:2   (C' is the high C, :2 holds a note for two beats)"
              aria-label="Notes"
            />
            <button type="button" onClick={useTyped}>
              Use these notes
            </button>
          </div>
        )}

        {bars.length > 0 && stage !== 'recording' && (
          <>
            <p className="muted">
              Check it by ear. To fix a note, tap it below, then tap the right bar.
            </p>
            <div className="strip" role="list" aria-label="Notes in the song">
              {bars.map((b, i) => (
                <span key={i} role="listitem" className={`strip-note ${selected === i ? 'sel' : ''}`}>
                  <button
                    type="button"
                    className="chip"
                    style={{ background: instrument.bars[b].colour, width: `${28 + 14 * beats[i]}px` }}
                    onClick={() => setSelected(selected === i ? null : i)}
                    aria-label={`Note ${i + 1}: ${instrument.bars[b].label}, ${beats[i]} beats${selected === i ? ', selected' : ''}`}
                  >
                    {instrument.bars[b].label}
                  </button>
                  {selected === i && (
                    <button type="button" className="x" onClick={() => remove(i)} aria-label={`Delete note ${i + 1}`}>
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            <ReplayControls notes={notes} instrument={instrument} xylo={xylo} />
            <div className="row">
              <button type="button" className="primary" onClick={save} disabled={stage === 'saving'}>
                {stage === 'saving' ? 'Saving, Gemma is building the lesson…' : 'Save song'}
              </button>
            </div>
          </>
        )}
        {error && <p className="warn">{error}</p>}
      </div>
    </section>
  )
}
