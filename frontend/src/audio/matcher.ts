import { audioConfig } from './audioConfig'

const cfg = audioConfig.detection

export interface Match {
  /** null when unsure: the strike is ignored. */
  bar: number | null
  score: number
  margin: number
}

/** Cosine similarity against every bar's template (both are unit length, so a dot product). */
export function matchSpectrum(spec: ArrayLike<number>, templates: ArrayLike<number>[]): Match {
  const scores = templates.map((t) => {
    let dot = 0
    for (let i = 0; i < t.length; i++) dot += t[i] * spec[i]
    return dot
  })
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a])
  const score = scores[order[0]] ?? 0
  const margin = score - (scores[order[1]] ?? 0)
  const sure = score >= cfg.minScore && margin >= cfg.minMargin
  return { bar: sure ? order[0] : null, score, margin }
}

/** Rows: the bar asked for. Columns: the bar heard, then a last column for unsure. */
export function confusionGrid(trials: { expected: number; got: number | null }[], barCount: number) {
  const grid = Array.from({ length: barCount }, () => new Array<number>(barCount + 1).fill(0))
  let correct = 0
  for (const { expected, got } of trials) {
    grid[expected][got ?? barCount]++
    if (got === expected) correct++
  }
  return { grid, correct, total: trials.length }
}
