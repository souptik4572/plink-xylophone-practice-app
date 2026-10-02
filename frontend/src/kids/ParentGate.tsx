import { House, Lock } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { useApp } from '../app/AppContext'
import { Button, Card, ScreenTitle } from '../ui/ui'
import { gateQuestion } from './gate'

const UNLOCKED = 'plink.grownupsUnlocked'

const wasUnlocked = () => {
  try {
    return sessionStorage.getItem(UNLOCKED) === '1'
  } catch {
    return false
  }
}

/**
 * Keeps small hands out of the grown-ups' screens (settings, delete all data)
 * with a sum to tap. Once answered it stays open until the browser tab closes.
 */
export function ParentGate({ children }: { children: ReactNode }) {
  const { settings, navigate } = useApp()
  const [open, setOpen] = useState(wasUnlocked)
  const [q, setQ] = useState(() => gateQuestion())
  const card = useRef<HTMLDivElement>(null)

  if (!settings.parent_gate || open) return <>{children}</>

  const answer = (n: number) => {
    if (n === q.answer) {
      try {
        sessionStorage.setItem(UNLOCKED, '1')
      } catch {
        // Storage blocked: the gate simply asks again next time.
      }
      setOpen(true)
      return
    }
    card.current?.animate([{ translate: '0 0' }, { translate: '-10px 0' }, { translate: '10px 0' }, { translate: '0 0' }], {
      duration: 300,
    })
    setQ(gateQuestion())
  }

  return (
    <section className="screen">
      <ScreenTitle kicker="For grown-ups" t={4}>
        Grown-ups <span className="gradient-text">only</span>
      </ScreenTitle>
      <div ref={card}>
        <Card t={4} pattern="dots" className="stack gate">
          <p className="with-icon dim">
            <Lock aria-hidden size={20} /> Settings and her data live here. Answer the sum to open.
          </p>
          <p className="gate-sum" id="gate-q">
            {q.a} + {q.b} = ?
          </p>
          <div className="gate-choices" role="group" aria-labelledby="gate-q">
            {q.choices.map((c, i) => (
              <Button key={c} variant="outline" t={i} onClick={() => answer(c)}>
                {c}
              </Button>
            ))}
          </div>
          <div className="row">
            <Button variant="ghost" t={1} icon={<House aria-hidden />} onClick={() => navigate('/')}>
              Back to playing
            </Button>
          </div>
        </Card>
      </div>
    </section>
  )
}
