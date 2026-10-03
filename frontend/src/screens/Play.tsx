import { ArrowRight, BrainCircuit, CircleAlert, Heart, Keyboard, ListOrdered, Mic, Piano, Play as PlayIcon, Repeat, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  getPraise,
  getProgress,
  nextDrill,
  postAttempts,
  saveSettings,
  startSession,
  writeParentNote,
  type Drill,
  type ParentNote,
} from '../api'
import { useApp } from '../app/AppContext'
import { useInsights } from '../app/useInsights'
import { lastSongId, rememberSong, useSongs } from '../app/useSongs'
import { audioConfig } from '../audio/audioConfig'
import { listenForBars } from '../audio/mic'
import { getAudioContext, playTone } from '../audio/synth'
import { barFrequency, isCalibrated } from '../instrument'
import { adviceText, HELP } from '../kids/help'
import { Mascot, type Mood } from '../kids/Mascot'
import { newSticker, type Sticker } from '../kids/stickers'
import { createPhraseRun, type HelpLevel, type PhraseRun } from '../play/phraseRun'
import { strikeBus, type BarStrike } from '../player/barStrike'
import { isTextEntry } from '../player/keymap'
import { attemptToNotes, slowNotes } from '../player/playback'
import { playOnce } from '../player/playOnce'
import { Xylophone, type XylophoneHandle } from '../player/Xylophone'
import { phraseBars, replayNotes, type ApiSong, type Phrase } from '../songs/songs'
import { cn, tone } from '../theme/palette'
import { confetti } from '../ui/confetti'
import { BigWord, Deco } from '../ui/Deco'
import { Button, Card, Chip, ScreenTitle, Switch } from '../ui/ui'
import { DEFAULT_PRAISE, pick, say } from '../voice'

const cfg = audioConfig.play

type Stage = 'setup' | 'playing' | 'phraseDone' | 'sessionDone'
type Source = 'onscreen' | 'mic'

interface Turn {
  song: ApiSong
  phraseIdx: number
  phrase: Phrase
  reason: Drill['reason']
}

/** What the grown-up sees under the stage: who chose this part, and why. */
function drillNote(d: Drill, tricky: number): string {
  if (d.source !== 'tabpfn') {
    if (d.reason === 'finish') return 'Her best part this session, to finish on'
    if (d.reason === 'jumps') return 'Practice for one of her trickiest jumps'
    return `In song order · TabPFN is still learning (${d.rows_used} notes so far)`
  }
  const why = d.reason === 'finish' ? 'TabPFN’s surest part, to finish on' : d.reason === 'jumps' ? 'TabPFN’s practice for a tricky jump' : 'TabPFN pick'
  const help = tricky ? ` · help comes sooner on ${tricky} tricky ${tricky === 1 ? 'note' : 'notes'}` : ''
  return `${why} · learned from ${d.rows_used} notes · ${Math.round((d.expected_success ?? 0) * 100)}% first-try chance${help}`
}


/** True once the page has had a click or key press, so audio may start without another. */
const canAutoplay = () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? false

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Wait mode (spec 7.4) as call and response: Plink plays the part, then it is
 * her turn. The target glows (unless she plays from memory), Plink waits, and
 * there is never a buzzer.
 */
export function Play({ songId: initialSong, autostart }: { songId?: string; autostart?: boolean }) {
  const { instrument, settings, setSettings, navigate, serverUp } = useApp()
  const { songs, offline } = useSongs()
  const insights = useInsights()
  const xylo = useRef<XylophoneHandle>(null)
  const [songId, setSongId] = useState(initialSong ?? lastSongId())
  const [source, setSource] = useState<Source>('onscreen')
  const [tester, setTester] = useState(false)
  const [helpLevel, setHelpLevel] = useState<HelpLevel>(settings.help_level)
  const [stage, setStage] = useState<Stage>('setup')
  const [turn, setTurn] = useState<Turn | null>(null)
  const [turnPhase, setTurnPhase] = useState<'demo' | 'turn'>('demo')
  const [progress, setProgress] = useState(0)
  const [lastTurn, setLastTurn] = useState<{ bar: number; t: number; correct: boolean }[]>([])
  const [stars, setStars] = useState<boolean[]>([])
  const [stats, setStats] = useState({ phrases: 0, notes: 0, firstTry: 0 })
  const [error, setError] = useState('')
  const [drill, setDrill] = useState<Drill | null>(null)
  const [note, setNote] = useState<ParentNote | 'writing' | null>(null)
  const [starting, setStarting] = useState(false)
  const [mood, setMood] = useState<Mood>('hello')
  const [bubble, setBubble] = useState('')
  const [sticker, setSticker] = useState<Sticker | null>(null)
  const praise = useRef(DEFAULT_PRAISE)
  const celebrateEl = useRef<HTMLDivElement>(null)
  /** Rows not yet saved; the parent note waits for them. */
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve())

  const session = useRef<{
    id: number
    start: number
    minutes: number
    starsBefore: number | null
    tester: boolean
    /** The last part has been given out: the session ends when it is done. */
    finalPart: boolean
    /** When the current part began, and how long the one before took: does another fit? */
    partStart: number
    lastPartMs: number
  } | null>(null)
  const run = useRef<PhraseRun | null>(null)
  const replaying = useRef(false)
  /** False between a right strike and the next target, so a strike there is not scored. */
  const waiting = useRef(false)
  /** Whether the target has been shown for this note yet (little help hides it at first). */
  const prompted = useRef(false)
  /** TabPFN's first-try prediction for each note of this part, when it chose the part. */
  const noteProbs = useRef<number[] | null>(null)
  /** Bumped to cancel a demonstration still in flight (Finish, next part). */
  const phaseToken = useRef(0)
  const hintTimer = useRef(0)
  const promptTimer = useRef(0)
  const moodTimer = useRef(0)
  const stopMic = useRef<(() => void) | null>(null)

  const help = cfg.help[helpLevel]
  const calibrated = isCalibrated(instrument)
  const playable = songs?.filter((s) => s.phrases.length > 0) ?? []
  const chosen = playable.find((s) => s.id === songId) ?? playable[0]
  const name = settings.child_name.trim()
  const songInsight = insights?.songs.find((s) => s.song_id === chosen?.id)
  const known = new Set(insights?.known_levels ?? [])

  const clearTimers = () => {
    clearTimeout(hintTimer.current)
    clearTimeout(promptTimer.current)
    clearTimeout(moodTimer.current)
  }

  useEffect(
    () => () => {
      clearTimers()
      phaseToken.current++
      stopMic.current?.()
      document.documentElement.removeAttribute('data-focus')
    },
    [],
  )

  // Focus: while she is finding a bar, page decorations step back.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-focus', stage === 'playing')
    // On short screens the celebration may sit below the fold: bring it into view.
    if (stage === 'phraseDone' || stage === 'sessionDone') {
      const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      setTimeout(() => celebrateEl.current?.scrollIntoView({ block: 'nearest', behavior: quiet ? 'auto' : 'smooth' }), 350)
    }
  }, [stage])

  const bar = (i: number) => instrument.bars[i]
  const colourWord = (i: number) => bar(i).colour_name ?? bar(i).label

  /** A face for a moment, then back to waiting for her. */
  const flashMood = (m: Mood) => {
    setMood(m)
    clearTimeout(moodTimer.current)
    moodTimer.current = window.setTimeout(() => setMood('turn'), cfg.moodMs)
  }

  const showTarget = (t: number, withTone: boolean) => {
    prompted.current = true
    clearTimeout(promptTimer.current)
    xylo.current?.highlight(t, null, { target: true })
    if (withTone) playTone(barFrequency(instrument, t))
  }

  const hint = () => {
    const t = run.current?.target()
    if (t === null || t === undefined) return
    showTarget(t, false)
    setBubble(`The ${colourWord(t)} one!`)
    flashMood('hint')
    say(`Try the ${colourWord(t)} one`)
  }

  const armHint = (ms: number = cfg.hintAfterSilenceMs) => {
    clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(hint, ms)
  }

  const presentNote = () => {
    const r = run.current
    const t = r?.target()
    if (!session.current || !r || t === null || t === undefined) return
    prompted.current = false
    r.present(performance.now())
    waiting.current = true
    // TabPFN's prediction for this very note decides how soon help arrives.
    const p = noteProbs.current?.[r.position()] ?? null
    const tricky = p !== null && p < cfg.adaptive.trickyBelow
    const easy = p !== null && p >= cfg.adaptive.easyFrom
    xylo.current?.only(help.onlyTarget && source === 'onscreen' ? t : null)
    if (help.glowAtStart) {
      showTarget(t, help.targetTone)
    } else {
      xylo.current?.highlight(null, null)
      const factor = tricky ? cfg.adaptive.trickyPromptFactor : easy ? cfg.adaptive.easyPromptFactor : 1
      promptTimer.current = window.setTimeout(() => {
        showTarget(t, true)
        setBubble('This one!')
      }, help.promptAfterMs * factor)
    }
    if (help.sayColour || (tricky && cfg.adaptive.sayColourWhenTricky)) {
      setBubble(`${colourWord(t)}!`)
      say(colourWord(t))
    } else {
      setBubble('Your turn!')
    }
    setProgress(r.position())
    armHint(tricky ? cfg.adaptive.trickyHintAfterMs : easy ? cfg.adaptive.easyHintAfterMs : cfg.hintAfterSilenceMs)
  }

  /** Plink's turn: play the part once, bars lighting, then hand over to her. */
  const demonstrate = async (t: Turn) => {
    const token = ++phaseToken.current
    const first = stats.phrases === 0
    waiting.current = false
    xylo.current?.only(null)
    xylo.current?.highlight(null, null)
    setTurnPhase('demo')
    setMood('listen')
    setBubble('Listen…')
    // Before the demonstration: a hello, "Last one!", or the line Gemma wrote for a jump practice part.
    const intro = first
      ? name
        ? `Hi ${name}! Listen first.`
        : 'Listen first!'
      : t.reason === 'finish'
        ? 'Last one!'
        : t.reason === 'jumps'
          ? t.phrase.tip || t.phrase.nickname
          : ''
    if (intro) {
      if (!first) setBubble(intro)
      say(intro)
      await sleep(Math.max(1100, intro.length * 70))
    }
    if (token !== phaseToken.current) return
    replaying.current = true
    await playOnce(slowNotes(replayNotes(t.song, t.phrase), help.demoTempo), instrument, xylo.current)
    replaying.current = false
    if (token !== phaseToken.current || !session.current) return
    await sleep(cfg.afterDemoMs)
    if (token !== phaseToken.current || !session.current) return
    setTurnPhase('turn')
    setMood('turn')
    if (first) say('Your turn!')
    presentNote()
  }

  const beginPhrase = (song: ApiSong, phraseIdx: number, probs: number[] | null, reason: Drill['reason']) => {
    const s = session.current!
    const phrase = song.phrases[phraseIdx]
    s.partStart = performance.now()
    noteProbs.current = probs
    run.current = createPhraseRun({
      sessionId: s.id,
      songId: song.id,
      phraseIdx,
      startNote: phrase.start,
      bars: phraseBars(song, phrase),
      sessionStart: s.start,
      helpLevel,
      predicted: probs,
    })
    setTurn({ song, phraseIdx, phrase, reason })
    setProgress(0)
    setStage('playing')
    // The setup page is long; the stage must start at the top with Plink and the bars in view.
    window.scrollTo({ top: 0 })
  }

  // Start each part after the playing view (and its xylophone) has mounted.
  const demoRef = useRef(demonstrate)
  useEffect(() => {
    demoRef.current = demonstrate
  })
  useEffect(() => {
    if (turn) void demoRef.current(turn)
  }, [turn])

  const goNext = async () => {
    const s = session.current
    if (!s || !chosen) return
    try {
      // A part that probably won't fit in the time left (it would take about as long as the
      // last one did) is the session's last: the one TabPFN expects her surest to get right.
      const final = s.minutes * 60000 - (performance.now() - s.start) < s.lastPartMs
      const d = await nextDrill(s.id, chosen.id, final)
      setDrill(d)
      if (d.reason === 'finish') s.finalPart = true
      const song = d.song ?? playable.find((x) => x.id === d.song_id) ?? chosen
      beginPhrase(song, d.phrase_idx, d.source === 'tabpfn' && song.id === d.song_id ? d.note_probs : null, d.reason)
    } catch (e) {
      setError(`Could not reach the local server: ${e instanceof Error ? e.message : e}`)
    }
  }

  const chooseHelp = (level: HelpLevel) => {
    setHelpLevel(level)
    // Remembered for next time; the grown-ups can change it in Settings too.
    saveSettings({ help_level: level })
      .then(setSettings)
      .catch(() => {})
  }

  const start = async () => {
    if (!chosen || starting) return
    setError('')
    setStarting(true)
    setSticker(null)
    getAudioContext() // this click is the user gesture that unlocks audio
    rememberSong(chosen.id)
    try {
      const s = await startSession(tester ? 'tester' : 'child')
      session.current = {
        id: s.id,
        start: performance.now(),
        minutes: settings.session_minutes,
        starsBefore: null,
        tester,
        finalPart: false,
        partStart: performance.now(),
        lastPartMs: 0,
      }
      getProgress()
        .then((p) => session.current && (session.current.starsBefore = p.stars))
        .catch(() => {})
      setStats({ phrases: 0, notes: 0, firstTry: 0 })
      setNote(null)
      // Gemma writes this session's praise in the background; the defaults cover the first part.
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
    } finally {
      setStarting(false)
    }
  }

  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })
  const autostarted = useRef(false)
  useEffect(() => {
    if (!autostart || autostarted.current || !chosen || offline || !canAutoplay()) return
    autostarted.current = true
    void startRef.current()
  }, [autostart, chosen, offline])

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
    // Ended early: the note is still written and kept for the grown-ups' screen.
    if (s && stats.phrases > 0 && note === null) void requestNote(s.id)
    clearTimers()
    phaseToken.current++
    stopMic.current?.()
    stopMic.current = null
    xylo.current?.only(null)
    xylo.current?.highlight(null, null)
    session.current = null
    setStage('setup')
    navigate('/')
  }

  const completePhrase = (r: PhraseRun) => {
    clearTimers()
    xylo.current?.only(null)
    xylo.current?.highlight(null, null)
    setProgress(r.position())
    setLastTurn(r.strikes())
    const rows = r.rows()
    const firstTry = rows.filter((x) => x.first_try_correct).length
    setStars(rows.map((x) => x.first_try_correct))
    setStats((st) => ({ phrases: st.phrases + 1, notes: st.notes + rows.length, firstTry: st.firstTry + firstTry }))
    pendingSave.current = postAttempts(rows).catch((e) =>
      setError(`Could not save this part: ${e instanceof Error ? e.message : e}`),
    )
    confetti()
    setMood('cheer')
    const line = pick(praise.current)
    setBubble(line)
    const s = session.current!
    s.lastPartMs = performance.now() - s.partStart
    // A session ends on its last part, which TabPFN chose for her to get right (see goNext).
    const over = s.finalPart
    // A sticker earned this session is revealed at the end, with the praise.
    const earned =
      over && !s.tester && s.starsBefore !== null ? newSticker(s.starsBefore, s.starsBefore + stats.firstTry + firstTry) : null
    setSticker(earned)
    say(earned ? `${line} You got a new sticker: ${earned.name}!` : line)
    setStage(over ? 'sessionDone' : 'phraseDone')
    if (over) void requestNote(s.id)
  }

  const accepts = (s: BarStrike) =>
    source === 'mic' ? s.source === 'mic' : s.source === 'pointer' || s.source === 'keyboard'

  const onStrike = (s: BarStrike) => {
    const r = run.current
    if (stage !== 'playing' || !r || !waiting.current || replaying.current || !accepts(s)) return
    const target = r.target()
    const result = r.strike(s.bar, s.source as 'mic' | 'pointer' | 'keyboard', s.t)
    if (result === 'wrong') {
      // Never a buzzer: the right bar says "here I am", and Plink glances at it.
      if (target !== null) {
        if (!prompted.current) showTarget(target, false)
        xylo.current?.nudge(target)
      }
      if (r.wrongSinceGlow() === cfg.hintAfterWrong) hint()
      else flashMood('hint')
      armHint()
    } else if (result === 'right') {
      waiting.current = false
      clearTimeout(hintTimer.current)
      clearTimeout(promptTimer.current)
      xylo.current?.sparkle(s.bar)
      xylo.current?.highlight(null, null)
      flashMood('happy')
      setProgress(r.position())
      window.setTimeout(presentNote, cfg.nextNoteDelayMs)
    } else if (result === 'complete') {
      waiting.current = false
      xylo.current?.sparkle(s.bar)
      completePhrase(r)
    }
  }

  const strikeHandler = useRef(onStrike)
  useEffect(() => {
    strikeHandler.current = onStrike
  })
  useEffect(() => strikeBus.subscribe((s) => strikeHandler.current(s)), [])

  const hearAgain = async () => {
    if (!turn || replaying.current || turnPhase === 'demo') return
    replaying.current = true
    run.current?.replayed()
    clearTimeout(hintTimer.current)
    setMood('listen')
    await playOnce(replayNotes(turn.song, turn.phrase), instrument, xylo.current)
    replaying.current = false
    setMood('turn')
    const t = run.current?.target()
    if (t !== null && t !== undefined) {
      // From memory, the glow stays hidden until it is needed.
      if (prompted.current) xylo.current?.highlight(t, null, { target: true })
      else xylo.current?.highlight(null, null)
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

  if (!serverUp || offline) {
    return (
      <section className="screen">
        <ScreenTitle kicker="Play" t={3}>
          Plink needs its server
        </ScreenTitle>
        <Card t={3} border="dashed" pattern="stripes" className="stack">
          <p className="dim">
            Play keeps her practice log, so the local server has to be running. Start it with <code>make dev</code>. Free
            play works without it.
          </p>
          <div className="row">
            <Button variant="primary" icon={<Piano aria-hidden />} onClick={() => navigate('/free')}>
              Free play
            </Button>
          </div>
        </Card>
      </section>
    )
  }

  if (stage === 'setup') {
    return (
      <section className="screen play-setup">
        <Deco
          items={[
            { emoji: '🎶', at: { top: '30%', right: '1%' }, size: 44, t: 1, motion: 'bounce', wide: true },
            { shape: 'circle', at: { top: '9%', right: '30%' }, size: 40, t: 0, motion: 'float', wide: true },
            { shape: 'sparkle', at: { bottom: '6%', right: '6%' }, size: 36, t: 4, motion: 'float-reverse' },
          ]}
        />
        <div className="screen-row">
          <ScreenTitle kicker="Play" t={1} gradient>
            Let’s play!
          </ScreenTitle>
          <Mascot mood="hello" say={name ? `Hi ${name}!` : 'Hi!'} size={110} />
        </div>

        <div className="setup-step">
          <h3 className="step-title ts-1">
            <span className="step-num tone-0">1</span> Pick a song
          </h3>
          {!songs ? (
            <p className="faint">Loading songs…</p>
          ) : (
            <div className="song-choices" role="group" aria-label="Song">
              {playable.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={chosen?.id === s.id}
                  className={cn('song-choice card card-sm-shadow', tone(i), i % 2 === 1 && 'card-dashed', chosen?.id === s.id && 'chosen')}
                  onClick={() => setSongId(s.id)}
                >
                  <span className="song-choice-title">{s.title}</span>
                  <span className="mini-strip" aria-hidden>
                    {s.bars.slice(0, 12).map((b, j) => (
                      <i key={j} style={{ background: instrument.bars[b]?.colour }} />
                    ))}
                  </span>
                  <span className="faint small">
                    {s.phrases.length} parts{s.misfits.length > 0 ? ' · almost fits' : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="setup-step">
          <h3 className="step-title ts-1">
            <span className="step-num tone-1">2</span> She plays on
          </h3>
          <div className="source-choices" role="group" aria-label="She plays on">
            <button
              type="button"
              aria-pressed={source === 'onscreen'}
              className={cn('source-choice card card-sm-shadow tone-1', source === 'onscreen' && 'chosen')}
              onClick={() => setSource('onscreen')}
            >
              <span className="icon-bubble" aria-hidden>
                <Keyboard />
              </span>
              <span className="stack-tight">
                <strong>The screen</strong>
                <span className="faint small">Tap the bars, or keys A S D F J K L ;</span>
              </span>
            </button>
            <button
              type="button"
              aria-pressed={source === 'mic'}
              disabled={!calibrated}
              className={cn('source-choice card card-sm-shadow card-dashed tone-3', source === 'mic' && 'chosen')}
              onClick={() => setSource('mic')}
            >
              <span className="icon-bubble" aria-hidden>
                <Mic />
              </span>
              <span className="stack-tight">
                <strong>
                  Her xylophone <Chip t={2}>Beta</Chip>
                </strong>
                <span className="faint small">
                  {calibrated ? 'Plink listens through the microphone' : 'Teach Plink her xylophone first (Grown-ups → Calibrate)'}
                </span>
              </span>
            </button>
          </div>
        </div>

        <div className="setup-step">
          <h3 className="step-title ts-1">
            <span className="step-num tone-2">3</span> How much help?
          </h3>
          {songInsight ? (
            <p className="bubble tone-4 with-icon">
              <BrainCircuit aria-hidden size={20} /> {adviceText(songInsight.help)}
            </p>
          ) : (
            insights?.source === 'fallback' && (
              <p className="faint small with-icon">
                <BrainCircuit aria-hidden size={18} /> TabPFN is still getting to know her ({insights.rows_used} notes so far). It
                starts advising after a short session.
              </p>
            )
          )}
          <div className="help-choices" role="group" aria-label="How much help">
            {HELP.map((h, i) => (
              <button
                key={h.level}
                type="button"
                aria-pressed={helpLevel === h.level}
                className={cn('source-choice card card-sm-shadow', tone(i + 2), i === 1 && 'card-dashed', helpLevel === h.level && 'chosen')}
                onClick={() => chooseHelp(h.level)}
              >
                <span className="help-emoji" aria-hidden>
                  {h.emoji}
                </span>
                <span className="stack-tight">
                  <strong>{h.title}</strong>
                  <span className="faint small">{h.text}</span>
                  {songInsight && (
                    <span className="row small help-insight">
                      {known.has(h.level) ? (
                        <Chip t={1} icon={<BrainCircuit aria-hidden />}>
                          {Math.round(songInsight.by_level[h.level] * 100)}% first try
                        </Chip>
                      ) : (
                        <Chip t={2} dashed>
                          Not tried yet
                        </Chip>
                      )}
                      {songInsight.help.level === h.level && songInsight.help.suggest !== 'stay' && (
                        <Chip t={4} solid>
                          {songInsight.help.suggest === 'try' ? 'Try this' : 'TabPFN suggests'}
                        </Chip>
                      )}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="setup-go">
          <Button
            variant="primary"
            size="lg"
            className="animate-pulse-glow"
            icon={starting ? <span className="spinner" aria-hidden /> : <PlayIcon aria-hidden />}
            onClick={start}
            disabled={!chosen || starting}
          >
            {starting ? 'Getting ready…' : 'Start'}
          </Button>
          <Switch t={4} checked={tester} onChange={(e) => setTester(e.target.checked)} label="A grown-up is testing (not counted)" />
          <p className="faint small">{settings.session_minutes} minute session · change it in Grown-ups → Settings</p>
        </div>
        {error && (
          <p className="alert" role="alert">
            <CircleAlert aria-hidden /> {error}
          </p>
        )}
      </section>
    )
  }

  const phraseLen = turn ? turn.phrase.end - turn.phrase.start + 1 : 0
  const trickyCount = drill?.source === 'tabpfn' ? (drill.note_probs ?? []).filter((p) => p < cfg.adaptive.trickyBelow).length : 0
  const firstTryPct = stats.notes ? Math.round((100 * stats.firstTry) / stats.notes) : 0

  return (
    <section className={cn('screen play-stage', stage !== 'playing' && 'celebrating')}>
      <div className="stage-head">
        <div className="stage-head-main">
          <Mascot mood={mood} say={bubble} />
          <div className="stack-tight">
            <p className="label tone-2">{turn?.song.title}</p>
            <h2 className="ts-2 stage-title">{turn?.phrase.nickname}</h2>
          </div>
        </div>
        <Button variant="ghost" t={3} icon={<X aria-hidden />} onClick={finish}>
          Finish
        </Button>
      </div>

      {turn && (
        <ol className={cn('pips', !help.glowAtStart && 'memory')} aria-label={`Note ${Math.min(progress + 1, phraseLen)} of ${phraseLen}`}>
          {phraseBars(turn.song, turn.phrase).map((b, i) => (
            <li
              key={i}
              className={cn(
                'pip',
                i < progress && 'done',
                i === progress && stage === 'playing' && turnPhase === 'turn' && 'now',
                (drill?.source === 'tabpfn' ? drill.note_probs?.[i] ?? 1 : 1) < cfg.adaptive.trickyBelow && 'tricky',
              )}
              style={{ '--pip': bar(b).colour } as React.CSSProperties}
            />
          ))}
        </ol>
      )}

      <Xylophone ref={xylo} instrument={instrument} keyboard={source === 'onscreen'} showKeyCaps={settings.show_key_caps} />

      {stage === 'playing' && (
        <div className="stage-actions">
          <Button
            variant="outline"
            t={1}
            size="lg"
            icon={<Volume2 aria-hidden />}
            onClick={hearAgain}
            disabled={turnPhase === 'demo'}
            aria-keyshortcuts="Space"
          >
            Hear it again
          </Button>
          {turn?.phrase.tip && (
            <p className="bubble tone-4 tip">
              <Heart aria-hidden size={18} /> {turn.phrase.tip}
            </p>
          )}
          {drill && (
            <Chip t={drill.source === 'tabpfn' ? 4 : 1} dashed icon={drill.source === 'tabpfn' ? <BrainCircuit aria-hidden /> : <ListOrdered aria-hidden />}>
              {drillNote(drill, trickyCount)}
            </Chip>
          )}
        </div>
      )}

      {(stage === 'phraseDone' || stage === 'sessionDone') && (
        <div className="celebrate" role="status" ref={celebrateEl}>
          <BigWord word={stage === 'sessionDone' ? 'DONE' : 'YAY'} t={0} at={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
          <p className="yay display gradient-text animate-pop">{stage === 'sessionDone' ? 'All done!' : 'Yay!'}</p>
          <p className="stars" aria-label={`${stars.filter(Boolean).length} of ${stars.length} notes right first time`}>
            {stars.map((s, i) => (
              <span key={i} className={cn('star', s && 'on')} style={{ animationDelay: `${i * 90}ms` }} aria-hidden>
                ★
              </span>
            ))}
          </p>

          {sticker && (
            <div className="sticker-reveal tone-2">
              <span className="sticker" aria-hidden>
                {sticker.emoji}
              </span>
              <p className="praise ts-2">New sticker!</p>
            </div>
          )}

          {stage === 'sessionDone' && (
            <div className="stats session-stats">
              <Card t={0} className="stat">
                <p className="label">Parts</p>
                <p className="stat-value">{stats.phrases}</p>
              </Card>
              <Card t={2} className="stat" border="dashed">
                <p className="label">Stars</p>
                <p className="stat-value">{stats.firstTry}</p>
              </Card>
              <Card t={1} className="stat">
                <p className="label">First try</p>
                <p className="stat-value">
                  {firstTryPct}
                  <span className="stat-unit">%</span>
                </p>
              </Card>
            </div>
          )}

          <div className="row celebrate-actions">
            <Button variant="secondary" t={1} icon={<Repeat aria-hidden />} onClick={playBackMyTurn}>
              Play back my turn
            </Button>
            {stage === 'phraseDone' ? (
              <Button variant="primary" size="lg" icon={<ArrowRight aria-hidden />} onClick={goNext}>
                Next
              </Button>
            ) : (
              <>
                <Button variant="outline" t={2} onClick={goNext}>
                  One more
                </Button>
                <Button variant="primary" size="lg" onClick={finish}>
                  Finish
                </Button>
              </>
            )}
          </div>

          {stage === 'sessionDone' && (
            <Card t={4} as="aside" className="grownup-note" pattern="dots" tilt="r" aria-live="polite">
              <div className="card-head">
                <span className="label">
                  <Heart aria-hidden size={16} /> For the grown-up
                </span>
                {note && note !== 'writing' && <span className="faint small">{note.source === 'gemma' ? `Gemma · ${note.seconds}s` : 'Summary'}</span>}
              </div>
              {note === 'writing' && (
                <p className="with-icon faint">
                  <span className="spinner" aria-hidden /> Gemma is writing today’s note…
                </p>
              )}
              {note && note !== 'writing' && (
                <>
                  <p className="note-text">{note.note}</p>
                  {note.weakest_jumps.length > 0 && (
                    <p className="row small">
                      <span className="faint">Trickiest jumps:</span>
                      {note.weakest_jumps.map((w, i) => (
                        <Chip key={i} t={i + 1}>
                          {w.from} → {w.to}
                        </Chip>
                      ))}
                    </p>
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {error && (
        <p className="alert" role="alert">
          <CircleAlert aria-hidden /> {error}
        </p>
      )}
    </section>
  )
}
