import { audioConfig } from '../audio/audioConfig'

// Replay engine (spec 7.3, Replay). Notes are put on the AudioContext clock a
// little ahead of time, and highlights are read from that same clock every
// animation frame, so sound and light cannot drift apart. setTimeout never
// decides when a note sounds.

const cfg = audioConfig.playback

export interface ReplayNote {
  bar: number
  t_ms: number
  dur_ms?: number
  /** A wrong strike in her attempt: shown in a muted colour. */
  muted?: boolean
  /** A song note with no exact bar, played on the nearest one. */
  misfit?: boolean
}

export function songToNotes(items: { bar: number; beats: number; misfit?: boolean }[], bpm: number): ReplayNote[] {
  const msPerBeat = 60000 / bpm
  let t = 0
  return items.map(({ bar, beats, misfit }) => {
    const note: ReplayNote = { bar, t_ms: t, dur_ms: beats * msPerBeat }
    if (misfit) note.misfit = true
    t += beats * msPerBeat
    return note
  })
}

/** Her attempt, in her own timing from the first strike. */
export function attemptToNotes(strikes: { bar: number; t: number; correct: boolean }[]): ReplayNote[] {
  const t0 = strikes[0]?.t ?? 0
  return strikes.map((s, i) => ({
    bar: s.bar,
    t_ms: s.t - t0,
    dur_ms: i + 1 < strikes.length ? strikes[i + 1].t - s.t : cfg.attemptTailMs,
    muted: !s.correct,
  }))
}

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'ended'

/** Indices into the note list: the sounding note, and the one cued next. */
export interface Highlight {
  current: number | null
  next: number | null
}

export interface PlaybackDeps {
  /** Audio clock in seconds: audioContext.currentTime. */
  now: () => number
  /** Sound a bar at an audio-clock time; returns a cancel function. */
  sound: (bar: number, when: number) => () => void
  /** Called once per note as it starts sounding. */
  onNote?: (note: ReplayNote, index: number) => void
}

interface Scheduled {
  idx: number
  when: number
  until: number
  cancel: () => void
  emitted: boolean
}

const durationOf = (n: ReplayNote) => n.dur_ms ?? cfg.attemptTailMs

export class PlaybackEngine {
  status: PlaybackStatus = 'idle'
  tempo = 1
  loop = false

  /** Score position in ms while paused or idle. */
  private posMs = 0
  /** Audio-clock time of score time 0 for the current pass. */
  private anchor = 0
  private nextIdx = 0
  private stepIdx = 0
  private queue: Scheduled[] = []
  private readonly totalMs: number

  constructor(
    private readonly notes: ReplayNote[],
    private readonly deps: PlaybackDeps,
  ) {
    const last = notes.at(-1)
    this.totalMs = last ? last.t_ms + durationOf(last) : 0
  }

  play() {
    if (this.status === 'playing') return
    if (this.notes.length === 0) {
      this.status = 'ended'
      return
    }
    if (this.status === 'ended') this.posMs = 0
    this.nextIdx = this.notes.findIndex((n) => n.t_ms >= this.posMs - 1e-6)
    if (this.nextIdx < 0) this.nextIdx = this.notes.length
    this.anchor = this.deps.now() + cfg.startLeadS - this.posMs / 1000 / this.tempo
    this.status = 'playing'
    this.pump()
  }

  pause() {
    if (this.status !== 'playing') return
    const now = this.deps.now()
    // Resume at the first note that has not started sounding yet.
    const pending = this.queue.filter((e) => e.when > now)
    pending.forEach((e) => e.cancel())
    this.queue = this.queue.filter((e) => e.when <= now)
    const resumeIdx = pending.length ? pending[0].idx : this.nextIdx
    const fromClock = Math.max(0, (now - this.anchor) * this.tempo * 1000)
    this.posMs = resumeIdx < this.notes.length ? Math.min(fromClock, this.notes[resumeIdx].t_ms) : fromClock
    this.status = 'paused'
  }

  toggle() {
    if (this.status === 'playing') this.pause()
    else this.play()
  }

  stop() {
    this.queue.forEach((e) => e.cancel())
    this.queue = []
    this.posMs = 0
    this.stepIdx = 0
    this.status = 'idle'
  }

  restart() {
    this.stop()
    this.play()
  }

  setTempo(tempo: number) {
    const wasPlaying = this.status === 'playing'
    if (wasPlaying) this.pause()
    this.tempo = tempo
    if (wasPlaying) this.play()
  }

  setLoop(loop: boolean) {
    this.loop = loop
  }

  /** Put every note that falls inside the lookahead window on the audio clock. */
  pump() {
    if (this.status !== 'playing') return
    const horizon = this.deps.now() + cfg.lookaheadS
    for (;;) {
      if (this.nextIdx >= this.notes.length) {
        if (!this.loop) return
        this.anchor += (this.totalMs + cfg.loopGapMs) / 1000 / this.tempo
        this.nextIdx = 0
      }
      const note = this.notes[this.nextIdx]
      const when = this.anchor + note.t_ms / 1000 / this.tempo
      if (when > horizon) return
      this.schedule(this.nextIdx, when)
      this.nextIdx++
    }
  }

  /** Read once per animation frame: what is lit now, and what is cued next. */
  frame(): Highlight {
    const now = this.deps.now()
    let current: Scheduled | null = null
    for (const e of this.queue) {
      if (e.when > now) break
      current = e
      if (!e.emitted) {
        e.emitted = true
        this.deps.onNote?.(this.notes[e.idx], e.idx)
      }
    }
    this.queue = this.queue.filter((e) => e === current || e.when > now)

    const upcoming = this.queue.find((e) => e.when > now)
    let next: number | null = upcoming ? upcoming.idx : null
    if (next === null && this.status === 'playing') {
      next = this.nextIdx < this.notes.length ? this.nextIdx : this.loop ? 0 : null
    }
    if (this.status === 'playing' && next === null && (!current || now >= current.until)) {
      this.status = 'ended'
      this.posMs = 0
    }
    return { current: current && now < current.until ? current.idx : null, next }
  }

  /** Step mode: sound the next note now. Returns its index. */
  step(): number {
    if (this.notes.length === 0) return -1
    if (this.status === 'playing') this.pause()
    const idx = this.stepIdx
    this.schedule(idx, this.deps.now(), true)
    this.stepIdx = (idx + 1) % this.notes.length
    return idx
  }

  private schedule(idx: number, when: number, untempoed = false) {
    const lit = (durationOf(this.notes[idx]) * cfg.litFraction) / 1000 / (untempoed ? 1 : this.tempo)
    this.queue.push({ idx, when, until: when + lit, cancel: this.deps.sound(this.notes[idx].bar, when), emitted: false })
    this.queue.sort((a, b) => a.when - b.when)
  }
}

/**
 * Browser wiring for the engine: a short interval tops up the lookahead
 * window, and requestAnimationFrame reports highlights. Callbacks fire only
 * when something changes, so React stays off the per-frame path.
 */
export class PlaybackDriver {
  readonly engine: PlaybackEngine
  private timer = 0
  private raf = 0
  private last = ''

  constructor(
    notes: ReplayNote[],
    deps: PlaybackDeps,
    private readonly onFrame: (h: Highlight, status: PlaybackStatus) => void,
  ) {
    this.engine = new PlaybackEngine(notes, deps)
    this.timer = window.setInterval(() => this.engine.pump(), cfg.pumpIntervalMs)
    const tick = () => {
      const h = this.engine.frame()
      const key = `${h.current}|${h.next}|${this.engine.status}`
      if (key !== this.last) {
        this.last = key
        this.onFrame(h, this.engine.status)
      }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  dispose() {
    clearInterval(this.timer)
    cancelAnimationFrame(this.raf)
    this.engine.stop()
  }
}
