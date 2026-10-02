import { useEffect, useRef, useState } from 'react'
import {
  getHealth,
  getPraise,
  listSongs,
  nextDrill,
  postAttempts,
  startSession,
  writeParentNote,
  type Drill,
  type ParentNote,
} from '../api'
import { audioConfig } from '../audio/audioConfig'
import { listenForBars } from '../audio/mic'
import { getAudioContext, playTone } from '../audio/synth'
import { barFrequency, isCalibrated, type Instrument } from '../instrument'
import { createPhraseRun, type PhraseRun } from '../play/phraseRun'
import { strikeBus, type BarStrike } from '../player/barStrike'
import { attemptToNotes } from '../player/playback'
import { playOnce } from '../player/playOnce'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import { phraseBars, replayNotes, type ApiSong, type Phrase } from '../songs/songs'
import { DEFAULT_PRAISE, pick, say } from '../voice'
import { isTextEntry } from '../player/keymap'

const cfg = audioConfig.play

type Stage = 'setup' | 'playing' | 'phraseDone' | 'sessionDone'
type Source = 'onscreen' | 'mic'

interface Turn {
  song: ApiSong
  phraseIdx: number
  phrase: Phrase
}

/** Wait mode (spec 7.4): glow the target, wait for the right bar, never buzz. */
export function Play({ instrument }: { instrument: Instrument }) {
  const xylo = useRef<XylophoneHandle>(null)
  const stageEl = useRef<HTMLDivElement>(null)
  const [songs, setSongs] = useState<ApiSong[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [songId, setSongId] = useState('twinkle')
  const [source, setSource] = useState<Source>('onscreen')
  const [tester, setTester] = useState(false)
  const [stage, setStage] = useState<Stage>('setup')
  const [turn, setTurn] = useState<Turn | null>(null)
  const [progress, setProgress] = useState(0)
  const [lastTurn, setLastTurn] = useState<{ bar: number; t: number; correct: boolean }[]>([])
  const [stats, setStats] = useState({ phrases: 0, notes: 0, firstTry: 0 })
  const [error, setError] = useState('')
  const [drill, setDrill] = useState<Drill | null>(null)
  const [note, setNote] = useState<ParentNote | 'writing' | null>(null)
  const praise = useRef(DEFAULT_PRAISE)
  /** Rows not yet saved; the parent note waits for them. */
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve())

  const session = useRef<{ id: number; start: number; minutes: number } | null>(null)
  const run = useRef<PhraseRun | null>(null)
  const replaying = useRef(false)
  /** False between a right strike and the next target, so a strike there is not scored. */
  const waiting = useRef(false)
  const hintTimer = useRef(0)
  const stopMic = useRef<(() => void) | null>(null)

  const calibrated = isCalibrated(instrument)

  useEffect(() => {
    listSongs()
      .then(setSongs)
      .catch(() => setLoadError(true))
  }, [])

  useEffect(
    () => () => {
      clearTimeout(hintTimer.current)
      stopMic.current?.()
    },
    [],
  )

  const bar = (i: number) => instrument.bars[i]

  const hint = () => {
    const t = run.current?.target()
    if (t === null || t === undefined) return
    say(`Try the ${bar(t).colour_name ?? bar(t).label} one`)
  }

  const armHint = () => {
    clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(hint, cfg.hintAfterSilenceMs)
  }

  const presentNote = () => {
    const r = run.current
    const t = r?.target()
    if (!session.current || !r || t === null || t === undefined) return
    xylo.current?.highlight(t, null)
    playTone(barFrequency(instrument, t))
    r.present(performance.now())
    waiting.current = true
    setProgress(r.position())
    armHint()
  }

  const beginPhrase = (song: ApiSong, phraseIdx: number) => {
    const s = session.current!
    const phrase = song.phrases[phraseIdx]
    run.current = createPhraseRun({
      sessionId: s.id,
      songId: song.id,
      phraseIdx,
      startNote: phrase.start,
      bars: phraseBars(song, phrase),
      sessionStart: s.start,
    })
    setTurn({ song, phraseIdx, phrase })
    setProgress(0)
    setStage('playing')
    presentNote()
  }

  const goNext = async () => {
    const s = session.current
    if (!s || !songs) return
    try {
      const d = await nextDrill(s.id, songId)
      setDrill(d)
      const song = songs.find((x) => x.id === d.song_id) ?? songs.find((x) => x.id === songId)!
      beginPhrase(song, d.phrase_idx)
    } catch (e) {
      setError(`Could not reach the local server: ${e instanceof Error ? e.message : e}`)
    }
  }

  const start = async () => {
    setError('')
    getAudioContext() // this click is the user gesture that unlocks audio
    try {
      const [s, health] = await Promise.all([startSession(tester ? 'tester' : 'child'), getHealth()])
      session.current = { id: s.id, start: performance.now(), minutes: health.session_minutes }
      setStats({ phrases: 0, notes: 0, firstTry: 0 })
      setNote(null)
      // Gemma writes this session's praise in the background; the defaults cover the first phrase.
      praise.current = DEFAULT_PRAISE
      getPraise()
        .then((p) => (praise.current = p.lines))
        .catch(() => {})
      if (source === 'mic') {
        stopMic.current = await listenForBars(
          instrument.noise_floor!,
          instrument.bars.map((b) => b.template!),
        )
      }
      await goNext()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const requestNote = async (sessionId: number) => {
    setNote('writing')
    await pendingSave.current
    try {
      setNote(await writeParentNote(sessionId))
    } catch {
      setNote(null)
    }
  }

  const finish = () => {
    const s = session.current
    // Ended early: the note is still written and kept for the Parent screen.
    if (s && stats.phrases > 0 && note === null) void requestNote(s.id)
    clearTimeout(hintTimer.current)
    stopMic.current?.()
    stopMic.current = null
    xylo.current?.highlight(null, null)
    session.current = null
    setStage('setup')
  }

  const celebrate = (big: boolean) => {
    stageEl.current?.animate(
      big
        ? [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }]
        : [{ filter: 'brightness(1)' }, { filter: 'brightness(1.15)' }, { filter: 'brightness(1)' }],
      { duration: big ? 600 : 250 },
    )
  }

  const completePhrase = (r: PhraseRun) => {
    clearTimeout(hintTimer.current)
    xylo.current?.highlight(null, null)
    setProgress(r.position())
    setLastTurn(r.strikes())
    const rows = r.rows()
    setStats((st) => ({
      phrases: st.phrases + 1,
      notes: st.notes + rows.length,
      firstTry: st.firstTry + rows.filter((x) => x.first_try_correct).length,
    }))
    pendingSave.current = postAttempts(rows).catch((e) =>
      setError(`Could not save this phrase: ${e instanceof Error ? e.message : e}`),
    )
    celebrate(true)
    say(pick(praise.current))
    const s = session.current!
    const over = performance.now() - s.start >= s.minutes * 60000
    setStage(over ? 'sessionDone' : 'phraseDone')
    if (over) void requestNote(s.id)
  }

  const accepts = (s: BarStrike) =>
    source === 'mic' ? s.source === 'mic' : s.source === 'pointer' || s.source === 'keyboard'

  const onStrike = (s: BarStrike) => {
    const r = run.current
    if (stage !== 'playing' || !r || !waiting.current || replaying.current || !accepts(s)) return
    const result = r.strike(s.bar, s.source as 'mic' | 'pointer' | 'keyboard', s.t)
    if (result === 'wrong') {
      if (r.wrongSinceGlow() === cfg.hintAfterWrong) hint()
      armHint()
    } else if (result === 'right') {
      waiting.current = false
      clearTimeout(hintTimer.current)
      celebrate(false)
      xylo.current?.highlight(null, null)
      setProgress(r.position())
      window.setTimeout(presentNote, cfg.nextNoteDelayMs)
    } else if (result === 'complete') {
      waiting.current = false
      completePhrase(r)
    }
  }

  const strikeHandler = useRef(onStrike)
  useEffect(() => {
    strikeHandler.current = onStrike
  })
  useEffect(() => strikeBus.subscribe((s) => strikeHandler.current(s)), [])

  const hearAgain = async () => {
    if (!turn || replaying.current) return
    replaying.current = true
    run.current?.replayed()
    clearTimeout(hintTimer.current)
    await playOnce(replayNotes(turn.song, turn.phrase), instrument, xylo.current)
    replaying.current = false
    const t = run.current?.target()
    if (t !== null && t !== undefined) {
      xylo.current?.highlight(t, null)
      armHint()
    }
  }

  const playBackMyTurn = async () => {
    if (replaying.current || lastTurn.length === 0) return
    replaying.current = true
    await playOnce(attemptToNotes(lastTurn), instrument, xylo.current)
    replaying.current = false
  }

  const hearRef = useRef(hearAgain)
  useEffect(() => {
    hearRef.current = hearAgain
  })
  useEffect(() => {
    if (stage !== 'playing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTextEntry(e.target)) return
      e.preventDefault()
      void hearRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage])

  if (loadError) {
    return (
      <section className="screen">
        <h2>Play</h2>
        <div className="panel">
          <p>Play needs the local server, which keeps her practice log. Start it with <code>make dev</code>.</p>
        </div>
      </section>
    )
  }

  if (stage === 'setup') {
    return (
      <section className="screen">
        <div className="screen-head">
          <h2>Play</h2>
        </div>
        <div className="panel setup">
          <label className="song-pick">
            Song
            <select value={songId} onChange={(e) => setSongId(e.target.value)} disabled={!songs}>
              {songs?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.misfits.length ? ' (almost fits)' : ''}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="choice">
            <legend>She plays on</legend>
            <label>
              <input type="radio" checked={source === 'onscreen'} onChange={() => setSource('onscreen')} />
              The on-screen xylophone (mouse, touch or keys)
            </label>
            <label className={calibrated ? '' : 'muted'}>
              <input
                type="radio"
                checked={source === 'mic'}
                disabled={!calibrated}
                onChange={() => setSource('mic')}
              />
              Her xylophone, through the microphone <span className="badge">beta</span>
              {!calibrated && ' (calibrate it on the Parent screen first)'}
            </label>
          </fieldset>
          <label className="toggle muted">
            <input type="checkbox" checked={tester} onChange={(e) => setTester(e.target.checked)} />
            A grown-up is testing (not counted in her progress)
          </label>
          <button type="button" className="primary" onClick={start} disabled={!songs}>
            Start
          </button>
          {error && <p className="warn">{error}</p>}
        </div>
      </section>
    )
  }

  const phraseLen = turn ? turn.phrase.end - turn.phrase.start + 1 : 0

  return (
    <section className="screen play">
      <div className="screen-head">
        <h2>{turn?.song.title}</h2>
        <button type="button" className="ghost" onClick={finish}>
          Finish
        </button>
      </div>

      <div ref={stageEl}>
        <Xylophone ref={xylo} instrument={instrument} keyboard={source === 'onscreen'} />
      </div>

      {turn && (
        <div className="progress" aria-label={`Note ${Math.min(progress + 1, phraseLen)} of ${phraseLen}`}>
          {phraseBars(turn.song, turn.phrase).map((b, i) => (
            <span
              key={i}
              className={`pip ${i < progress ? 'done' : ''} ${i === progress && stage === 'playing' ? 'now' : ''}`}
              style={{ background: i < progress ? bar(b).colour : undefined, borderColor: bar(b).colour }}
            />
          ))}
        </div>
      )}

      {stage === 'playing' && (
        <div className="actions">
          <button type="button" className="huge" onClick={hearAgain} aria-keyshortcuts="Space">
            🔊 Hear it again
          </button>
          {turn?.phrase.tip && <p className="muted tip">{turn.phrase.tip}</p>}
          {drill && (
            <p className="muted tip picked-by">
              {turn?.phrase.nickname} ·{' '}
              {drill.source === 'tabpfn'
                ? `chosen by TabPFN: about ${Math.round((drill.expected_success ?? 0) * 100)}% likely right first time`
                : 'in song order: not enough practice yet for TabPFN to choose'}
            </p>
          )}
        </div>
      )}

      {stage === 'phraseDone' && (
        <div className="actions">
          <p className="say yay">🎉 Yay!</p>
          <button type="button" onClick={playBackMyTurn}>
            ▶ Play back my turn
          </button>
          <button type="button" className="huge" onClick={goNext}>
            Next →
          </button>
        </div>
      )}

      {stage === 'sessionDone' && (
        <div className="actions">
          <p className="say yay">⭐ All done for today!</p>
          <p className="muted">
            {stats.phrases} phrases · {stats.notes ? Math.round((100 * stats.firstTry) / stats.notes) : 0}% of notes
            right first time
          </p>
          <button type="button" onClick={playBackMyTurn}>
            ▶ Play back my turn
          </button>
          <button type="button" onClick={goNext}>
            One more
          </button>
          <button type="button" className="huge" onClick={finish}>
            Finish
          </button>
          <aside className="note" aria-live="polite">
            <h3>For the grown-up</h3>
            {note === 'writing' && <p className="muted">Gemma is writing today's note…</p>}
            {note && note !== 'writing' && (
              <>
                <p>{note.note}</p>
                <p className="muted small">
                  {note.source === 'gemma' ? `Written by Gemma in ${note.seconds}s` : 'Gemma was unavailable; a plain summary'}
                  {note.weakest_jumps.length > 0 &&
                    ` · trickiest jumps: ${note.weakest_jumps.map((w) => `${w.from}→${w.to}`).join(', ')}`}
                </p>
              </>
            )}
          </aside>
        </div>
      )}

      {error && <p className="warn">{error}</p>}
    </section>
  )
}
