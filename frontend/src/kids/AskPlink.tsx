import { BrainCircuit, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { askPlink, type AskReply } from '../api'
import { cn } from '../theme/palette'
import { Button, Card, Chip } from '../ui/ui'
import { answerBlocks, toolLabel } from './answer'
import { Mascot } from './Mascot'

const STARTERS = ['What should we practise next?', 'Is she ready for Jingle Bells?', 'Should she have less help?', 'How has she been doing?']

interface Turn {
  question: string
  reply: AskReply | null
}

/**
 * Ask Plink: Gemma answers a grown-up's question by calling read-only tools
 * over her practice data and TabPFN. Each answer shows which tools it used.
 */
export function AskPlink() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const busy = turns.at(-1)?.reply === null
  const end = useRef<HTMLDivElement>(null)

  // Block body: Chrome's scrollIntoView now returns a Promise, which React would take for a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [turns])

  const ask = async (question: string) => {
    const q = question.trim()
    if (!q || busy) return
    setText('')
    const history = turns.flatMap((t) =>
      t.reply ? [{ role: 'user' as const, content: t.question }, { role: 'assistant' as const, content: t.reply.answer }] : [],
    )
    setTurns((ts) => [...ts, { question: q, reply: null }])
    let reply: AskReply
    try {
      reply = await askPlink(q, history)
    } catch {
      reply = { answer: 'Plink’s server isn’t answering. Is make dev running?', tools: [], seconds: 0 }
    }
    setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, reply } : t)))
  }

  return (
    <Card t={1} pattern="dots" className="stack ask">
      <div className="ask-head">
        <Mascot mood={busy ? 'hint' : 'hello'} say={busy ? 'Let me check…' : 'Ask me about her practice!'} size={96} />
        <p className="dim small">
          Gemma answers from her real practice data, asking TabPFN for predictions. Everything runs on this laptop.
        </p>
      </div>

      <div className="ask-log" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className="stack-tight ask-turn">
            <p className="ask-q">{t.question}</p>
            {t.reply === null ? (
              <p className="ask-a with-icon faint">
                <span className="spinner" aria-hidden /> Gemma is looking it up…
              </p>
            ) : (
              <div className="ask-a">
                {answerBlocks(t.reply.answer).map((b, j) => {
                  const body = b.runs.map((r, k) => (r.bold ? <strong key={k}>{r.text}</strong> : <span key={k}>{r.text}</span>))
                  return b.kind === 'li' ? (
                    <p key={j} className="ask-li">
                      • {body}
                    </p>
                  ) : (
                    <p key={j}>{body}</p>
                  )
                })}
                {t.reply.tools.length > 0 && (
                  <p className="row ask-tools">
                    {t.reply.tools.map((tool, k) => (
                      <Chip key={k} t={tool.ok ? 4 : 3} dashed={!tool.ok} icon={<BrainCircuit aria-hidden />}>
                        {toolLabel(tool)}
                      </Chip>
                    ))}
                    <span className="faint small">{t.reply.seconds}s</span>
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      {turns.length === 0 && (
        <div className="row">
          {STARTERS.map((s, i) => (
            <Button key={s} variant="secondary" size="sm" t={i} onClick={() => void ask(s)}>
              {s}
            </Button>
          ))}
        </div>
      )}

      <form
        className={cn('row ask-form')}
        onSubmit={(e) => {
          e.preventDefault()
          void ask(text)
        }}
      >
        <input
          className="input grow tone-1"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about her practice, songs or help level"
          aria-label="Your question"
          disabled={busy}
        />
        <Button type="submit" variant="primary" icon={<Send aria-hidden />} disabled={busy || !text.trim()}>
          Ask
        </Button>
      </form>
    </Card>
  )
}
