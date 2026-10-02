import type { StrikeSource } from '../player/barStrike'

/**
 * How much the game helps (fading prompts): lots = errorless, only the target
 * counts; some = glow and hints; little = from memory, glow only when stuck.
 */
export type HelpLevel = 'lots' | 'some' | 'little'

/** One row per expected note, as POST /api/attempts takes it (spec 7.8). */
export interface AttemptRow {
  session_id: number
  song_id: string
  phrase_idx: number
  note_idx: number
  target_bar: number
  prev_bar: number | null
  pos_in_phrase: number
  phrase_len: number
  input_source: Exclude<StrikeSource, 'replay'>
  replays_before: number
  mins_into_session: number
  response_ms: number
  wrong_before_correct: number
  first_try_correct: boolean
  help_level: HelpLevel
  predicted_success: number | null
}

export interface PhraseSpec {
  sessionId: number
  songId: string
  phraseIdx: number
  /** Index in the song of the phrase's first note. */
  startNote: number
  bars: number[]
  /** performance.now() when the session started. */
  sessionStart: number
  helpLevel?: HelpLevel
  /** TabPFN's first-try prediction per note, when TabPFN chose the part. */
  predicted?: number[] | null
}

export type StrikeResult = 'right' | 'wrong' | 'complete' | 'ignored'

/**
 * Wait mode for one phrase (spec 7.4): the target glows until the right bar
 * is struck; wrong strikes are logged, never punished. Pure: the caller
 * passes in times, so it is testable without a browser.
 */
export function createPhraseRun(spec: PhraseSpec) {
  const helpLevel = spec.helpLevel ?? 'some'
  let pos = 0
  let glowAt = 0
  let firstStrikeAt: number | null = null
  let firstSource: AttemptRow['input_source'] | null = null
  let wrong = 0
  let replays = 0
  let struckYet = false
  const rows: AttemptRow[] = []
  const strikes: { bar: number; t: number; correct: boolean }[] = []

  return {
    target: () => (pos < spec.bars.length ? spec.bars[pos] : null),
    position: () => pos,
    done: () => pos >= spec.bars.length,
    wrongSinceGlow: () => wrong,
    rows: () => rows,
    strikes: () => strikes,

    /** The current note starts glowing. */
    present(now: number) {
      glowAt = now
      firstStrikeAt = null
      firstSource = null
      wrong = 0
    },

    /** "Hear it again" was pressed. Only counts before her first strike in the phrase. */
    replayed() {
      if (!struckYet) replays++
    },

    strike(bar: number, source: AttemptRow['input_source'], now: number): StrikeResult {
      if (pos >= spec.bars.length) return 'ignored'
      const correct = bar === spec.bars[pos]
      // Errorless learning: with lots of help only the target counts, so a miss leaves no trace.
      if (!correct && helpLevel === 'lots') return 'ignored'
      struckYet = true
      firstStrikeAt ??= now
      firstSource ??= source
      strikes.push({ bar, t: now, correct })
      if (!correct) {
        wrong++
        return 'wrong'
      }
      rows.push({
        session_id: spec.sessionId,
        song_id: spec.songId,
        phrase_idx: spec.phraseIdx,
        note_idx: spec.startNote + pos,
        target_bar: spec.bars[pos],
        prev_bar: pos > 0 ? spec.bars[pos - 1] : null,
        pos_in_phrase: pos,
        phrase_len: spec.bars.length,
        input_source: firstSource,
        replays_before: replays,
        mins_into_session: Math.round(((glowAt - spec.sessionStart) / 60000) * 1000) / 1000,
        response_ms: Math.max(0, Math.round(firstStrikeAt - glowAt)),
        wrong_before_correct: wrong,
        first_try_correct: wrong === 0,
        help_level: helpLevel,
        predicted_success: spec.predicted?.[pos] ?? null,
      })
      pos++
      return pos >= spec.bars.length ? 'complete' : 'right'
    },
  }
}

export type PhraseRun = ReturnType<typeof createPhraseRun>
