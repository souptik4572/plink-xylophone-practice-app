// A grown-ups gate: a sum a young child can't yet do, with four big answers to tap.

export interface GateQuestion {
  a: number
  b: number
  answer: number
  choices: number[]
}

export function gateQuestion(rand: () => number = Math.random): GateQuestion {
  const a = 6 + Math.floor(rand() * 9) // 6..14
  const b = 4 + Math.floor(rand() * 8) // 4..11
  const answer = a + b
  const choices = new Set([answer])
  const offsets = [-2, -1, 1, 2, 3, -3, 4, -4]
  let k = Math.floor(rand() * offsets.length)
  while (choices.size < 4) {
    choices.add(answer + offsets[k % offsets.length])
    k++
  }
  // Shuffle by a rotation from the same source, so tests stay deterministic.
  const list = [...choices].sort((x, y) => x - y)
  const r = Math.floor(rand() * 4)
  return { a, b, answer, choices: [...list.slice(r), ...list.slice(0, r)] }
}
