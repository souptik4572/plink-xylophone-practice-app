import { useEffect, useState } from 'react'
import { DEFAULT_INSTRUMENT } from './instrument'
import { FreePlay } from './screens/FreePlay'

type Health = { ok: boolean; ollama: boolean; gemma_model: string; tabpfn: boolean }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  return (
    <div className="app">
      <header className="top">
        <h1>
          Plink<span aria-hidden>·</span>
        </h1>
        <nav aria-label="Screens">
          <button type="button" className="on" aria-current="page">
            Free play
          </button>
        </nav>
      </header>

      <main>
        <FreePlay instrument={DEFAULT_INSTRUMENT} />
      </main>

      <footer className="status">
        {health ? (
          <>
            Gemma {health.ollama ? 'ready' : 'offline'} · TabPFN {health.tabpfn ? 'ready' : 'not loaded'}
          </>
        ) : (
          'Local server not running: free play still works'
        )}
      </footer>
    </div>
  )
}
