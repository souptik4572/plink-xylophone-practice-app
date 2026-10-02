import { ArrowLeft, Camera, Circle, CopyPlus, Keyboard, Mic, MicVocal, Play, Plus, ScanEye, Sparkles, Square, Trash2, Type } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildLesson, createSong, fitNotes, readCard } from '../api'
import { useApp } from '../app/AppContext'
import { audioConfig } from '../audio/audioConfig'
import { listenForBars } from '../audio/mic'
import { getAudioContext } from '../audio/synth'
import { isCalibrated } from '../instrument'
import { strikeBus, type BarStrike } from '../player/barStrike'
import { songToNotes } from '../player/playback'
import { ReplayControls } from '../player/ReplayControls'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import { Mascot } from '../kids/Mascot'
import { cleanNotes, envelope, notesToText, recordVoice, transcribe } from '../songs/hum'
import { lettersToTune, snapToBeats } from '../songs/recordTune'
import type { ApiSong } from '../songs/songs'
import { cn, tone } from '../theme/palette'
import { confetti } from '../ui/confetti'
import { Button, Card, Field, ScreenTitle, Switch } from '../ui/ui'

type Route = 'play' | 'sing' | 'photo' | 'type'

/** Shrink a photo in the browser before it goes to the local server: Gemma reads ~1280 px as well as 12 MP. */
async function shrinkPhoto(file: File, maxSide = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.88)
}
type SingState = 'idle' | 'countdown' | 'singing' | 'thinking'
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
      setMisfits((m) => m.filter((x) => x !== selected))
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

  const [sing, setSing] = useState<SingState>('idle')
  const [count, setCount] = useState(3)
  const [levels, setLevels] = useState<number[]>(() => Array(10).fill(0.05))
  const [elapsed, setElapsed] = useState(0)
  const [heard, setHeard] = useState('')
  const [misfits, setMisfits] = useState<number[]>([])
  const voice = useRef<Awaited<ReturnType<typeof recordVoice>> | null>(null)
  const singTimer = useRef(0)

  useEffect(() => () => clearInterval(singTimer.current), [])

  const startSinging = async () => {
    getAudioContext()
    setError('')
    setHeard('')
    setMisfits([])
    setSelected(null)
    // A 3-2-1 so she can take a breath and start together with Plink.
    setSing('countdown')
    for (const n of [3, 2, 1]) {
      setCount(n)
      await new Promise((r) => setTimeout(r, 700))
    }
    try {
      voice.current = await recordVoice(
        (level) => setLevels((ls) => [...ls.slice(1), Math.max(0.05, level)]),
        () => void stopSinging(),
      )
    } catch (e) {
      setSing('idle')
      setError(`The microphone is needed for singing: ${e instanceof Error ? e.message : e}`)
      return
    }
    const t0 = performance.now()
    setElapsed(0)
    singTimer.current = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 200)
    setSing('singing')
  }

  const stopSinging = async () => {
    const v = voice.current
    if (!v) return
    voice.current = null
    clearInterval(singTimer.current)
    const take = v.stop()
    setSing('thinking')
    setHeard('Plink is listening back… 0%')
    try {
      const raw = await transcribe(take.samples, take.sampleRate, (p) => setHeard(`Plink is listening back… ${Math.round(p * 100)}%`))
      const notes = cleanNotes(raw, envelope(take.samples, take.sampleRate))
      if (notes.length === 0) {
        setHeard('')
        setError('Plink didn’t hear any notes. Try again a little louder, closer to the laptop.')
        setSing('idle')
        return
      }
      const fit = await fitNotes(notesToText(notes))
      setBars(fit.bars)
      setBeats(fit.beats)
      setMisfits(fit.misfits)
      const moved = fit.transposition === 0 ? '' : ` Moved ${Math.abs(fit.transposition)} steps ${fit.transposition > 0 ? 'up' : 'down'} to fit her bars.`
      const odd = fit.misfits.length ? ` ${fit.misfits.length} need a bar she doesn’t have (dashed): check those.` : ''
      setHeard(`Plink heard ${fit.bars.length} notes.${moved}${odd}`)
    } catch (e) {
      setHeard('')
      setError(`Plink couldn’t work out the tune: ${e instanceof Error ? e.message : e}`)
    }
    setSing('idle')
  }

  const [photo, setPhoto] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  const choosePhoto = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setHeard('')
    try {
      setPhoto(await shrinkPhoto(file))
    } catch {
      setError('That file doesn’t look like a photo Plink can open.')
    }
  }

  const readPhoto = async () => {
    if (!photo) return
    setReading(true)
    setError('')
    setHeard('Gemma is counting the notes on the card…')
    try {
      const r = await readCard(photo)
      if (r.bars.length === 0) {
        setHeard('')
        setError('Gemma couldn’t find any notes on that card. Try a straighter, closer photo in good light.')
        return
      }
      setBars(r.bars)
      setBeats(r.beats)
      setMisfits(r.flagged)
      setSelected(null)
      if (!title.trim() && r.title) setTitle(r.title)
      const rows = r.counts.length > 1 ? `${r.counts.length} rows (${r.counts.join(' + ')} notes)` : `${r.bars.length} notes`
      const check = r.flagged.length ? ` ${r.flagged.length} dashed ${r.flagged.length === 1 ? 'note' : 'notes'} didn’t match ${r.flagged.length === 1 ? 'its' : 'their'} colour: check against the photo.` : ''
      const lost = r.unreadable ? ` ${r.unreadable} couldn’t be read.` : ''
      setHeard(`Gemma read ${rows} in ${Math.round(r.seconds)}s.${check}${lost}`)
    } catch (e) {
      setHeard('')
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReading(false)
    }
  }

  const duplicate = (i: number) => {
    setBars((b) => [...b.slice(0, i + 1), b[i], ...b.slice(i + 1)])
    setBeats((b) => [...b.slice(0, i + 1), b[i], ...b.slice(i + 1)])
    setMisfits((m) => m.filter((x) => x <= i).concat(m.filter((x) => x > i).map((x) => x + 1)))
    setSelected(i + 1)
  }

  const remove = (i: number) => {
    setBars((b) => b.filter((_, j) => j !== i))
    setBeats((b) => b.filter((_, j) => j !== i))
    setMisfits((m) => m.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)))
    setSelected(null)
  }

  const save = async () => {
    if (!title.trim()) return setError('Give the song a name first')
    setError('')
    setStage('saving')
    try {
      const song = await createSong({ title: title.trim(), source: route === 'play' ? 'played' : route === 'sing' ? 'hummed' : route === 'photo' ? 'photo' : 'typed', bars, beats })
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
          <p className="with-icon dim">
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
            aria-selected={route === 'sing'}
            icon={<MicVocal aria-hidden />}
            onClick={() => setRoute('sing')}
            disabled={stage === 'recording' || sing !== 'idle'}
          >
            Sing it
          </Button>
          <Button
            variant="secondary"
            t={0}
            role="tab"
            aria-selected={route === 'photo'}
            icon={<Camera aria-hidden />}
            onClick={() => setRoute('photo')}
            disabled={stage === 'recording' || sing !== 'idle' || reading}
          >
            From a photo
          </Button>
          <Button
            variant="secondary"
            t={4}
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

        {route === 'sing' && (
          <div className="sing">
            <Mascot
              mood={sing === 'singing' ? 'listen' : sing === 'thinking' ? 'hint' : 'hello'}
              say={sing === 'countdown' ? String(count) : sing === 'singing' ? 'La la la!' : sing === 'thinking' ? 'Hmm…' : 'Sing to me!'}
              size={110}
            />
            <div className="stack">
              <p className="dim">
                Sing or hum the tune, slowly and clearly, up to {audioConfig.hum.maxSeconds} seconds. Plink works out the notes
                right here on this laptop and fits them to her bars.
              </p>
              <div className="row">
                {sing === 'singing' ? (
                  <>
                    <Button variant="primary" size="lg" className="recording" icon={<Square aria-hidden />} onClick={() => void stopSinging()}>
                      Done
                    </Button>
                    <span className="sing-meter" aria-hidden>
                      {levels.map((l, i) => (
                        <i key={i} style={{ height: `${Math.round(l * 100)}%` }} />
                      ))}
                    </span>
                    <span className="sing-time" aria-label={`${Math.floor(elapsed)} seconds`}>
                      {Math.floor(elapsed)}s
                    </span>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    size="lg"
                    icon={sing === 'thinking' ? <span className="spinner" aria-hidden /> : <MicVocal aria-hidden />}
                    onClick={() => void startSinging()}
                    disabled={sing !== 'idle'}
                  >
                    {sing === 'countdown' ? `${count}…` : sing === 'thinking' ? 'Listening back…' : bars.length ? 'Sing again' : 'Start singing'}
                  </Button>
                )}
              </div>
              {heard && <p className="bubble tone-1">{heard}</p>}
            </div>
          </div>
        )}

        {route === 'photo' && (
          <div className="sing">
            <Mascot mood={reading ? 'hint' : 'hello'} say={reading ? 'Hmm, counting…' : 'Show me the card!'} size={110} />
            <div className="stack">
              <p className="dim">
                Toy xylophones come with colour or number song cards. Take a photo of one (or of a songbook page with note letters),
                and Gemma reads it right here on this laptop. The photo isn’t kept.
              </p>
              <div className="row">
                <label className="btn btn-outline tone-0 file-btn">
                  <Camera aria-hidden /> {photo ? 'Another photo' : 'Choose or take a photo'}
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => void choosePhoto(e.target.files?.[0])} />
                </label>
                {photo && (
                  <Button
                    variant="primary"
                    icon={reading ? <span className="spinner" aria-hidden /> : <ScanEye aria-hidden />}
                    onClick={() => void readPhoto()}
                    disabled={reading}
                  >
                    {reading ? 'Gemma is reading… about 30 s' : 'Read it with Gemma'}
                  </Button>
                )}
              </div>
              {photo && <img className="card-photo" src={photo} alt="The song card you chose" />}
              {heard && <p className="bubble tone-1">{heard}</p>}
            </div>
          </div>
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
                  className={cn('strip-chip', misfits.includes(i) && 'misfit')}
                  style={{ background: instrument.bars[b].colour, width: `${30 + 16 * beats[i]}px` }}
                  onClick={() => setSelected(selected === i ? null : i)}
                  aria-label={`Note ${i + 1}: ${instrument.bars[b].label}, ${beats[i]} beats${selected === i ? ', selected' : ''}`}
                >
                  {instrument.bars[b].label}
                </button>
                {selected === i && (
                  <button type="button" className="strip-add" onClick={() => duplicate(i)} aria-label={`Add a note after note ${i + 1}`}>
                    <CopyPlus aria-hidden size={14} />
                  </button>
                )}
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
