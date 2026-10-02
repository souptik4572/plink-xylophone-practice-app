// Gemma sometimes answers with light markdown; render bold runs and bullet lines safely, as text.

export interface Run {
  text: string
  bold: boolean
}

export interface Block {
  kind: 'p' | 'li'
  runs: Run[]
}

function runs(line: string): Run[] {
  const parts = line.split(/\*\*(.+?)\*\*/g)
  return parts
    .map((text, i) => ({ text, bold: i % 2 === 1 }))
    .filter((r) => r.text.length > 0)
}

export function answerBlocks(text: string): Block[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const item = /^[*-]\s+/.exec(l)
      return { kind: item ? 'li' : 'p', runs: runs(item ? l.slice(item[0].length) : l) }
    })
}

export interface ToolUse {
  name: string
  args: Record<string, unknown>
  ok: boolean
}

const LABELS: Record<string, (args: Record<string, unknown>) => string> = {
  predict_song: (a) => `TabPFN predicted ${a.song ?? 'a song'}`,
  list_songs: () => 'TabPFN ranked her songs',
  help_advice: () => 'TabPFN help advice',
  get_progress: () => 'Her progress',
  recent_sessions: () => 'Recent sessions',
}

export function toolLabel(t: ToolUse): string {
  return LABELS[t.name]?.(t.args) ?? t.name
}
