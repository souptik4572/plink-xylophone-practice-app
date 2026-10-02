import { useEffect, useState } from 'react'
import { getHealth, loadInstrument, type Health } from './api'
import { DEFAULT_INSTRUMENT, type Instrument } from './instrument'
import { setSpeechLang } from './voice'
import { AddSong } from './screens/AddSong'
import { FreePlay } from './screens/FreePlay'
import { Parent } from './screens/Parent'
import { Play } from './screens/Play'

const SCREENS = [
  { id: 'play', label: 'Play' },
  { id: 'free', label: 'Free play' },
  { id: 'add', label: 'Add a song' },
  { id: 'parent', label: 'Parent' },
] as const
type ScreenId = (typeof SCREENS)[number]['id']

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [instrument, setInstrument] = useState<Instrument>(DEFAULT_INSTRUMENT)
  const [screen, setScreen] = useState<ScreenId>('play')

  useEffect(() => {
    getHealth()
      .then((h) => {
        setHealth(h)
        setSpeechLang(h.speech_lang)
      })
      .catch(() => setHealth(null))
    void loadInstrument().then((saved) => saved && setInstrument(saved))
  }, [])

  return (
    <div className="app">
      <header className="top">
        <h1>
          Plink<span aria-hidden>·</span>
        </h1>
        <nav aria-label="Screens">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={screen === s.id ? 'on' : ''}
              aria-current={screen === s.id ? 'page' : undefined}
              onClick={() => setScreen(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {screen === 'play' && <Play instrument={instrument} />}
        {screen === 'free' && <FreePlay instrument={instrument} />}
        {screen === 'add' && <AddSong instrument={instrument} onAdded={() => {}} />}
        {screen === 'parent' && (
          <Parent
            instrument={instrument}
            onInstrument={setInstrument}
            onDeleted={() => setInstrument(DEFAULT_INSTRUMENT)}
          />
        )}
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
