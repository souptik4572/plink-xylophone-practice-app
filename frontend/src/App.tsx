import { House, ListMusic, Lock, Piano, Play as PlayIcon, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getHealth, getSettings, loadInstrument, type Health, type Settings } from './api'
import { AppContext, DEFAULT_SETTINGS } from './app/AppContext'
import { useRoute } from './app/route'
import { DEFAULT_INSTRUMENT, withColourNames, type Instrument } from './instrument'
import { FreePlay } from './screens/FreePlay'
import { Home } from './screens/Home'
import { ParentGate } from './kids/ParentGate'
import { GrownUps } from './screens/Parent'
import { Play } from './screens/Play'
import { Songs } from './screens/Songs'
import { cn, tone } from './theme/palette'
import { Chip } from './ui/ui'
import { setSpeechLang } from './voice'

const NAV = [
  { screen: 'home', path: '/', label: 'Home', icon: House },
  { screen: 'play', path: '/play', label: 'Play', icon: PlayIcon },
  { screen: 'free', path: '/free', label: 'Free play', icon: Piano },
  { screen: 'songs', path: '/songs', label: 'Songs', icon: ListMusic },
  { screen: 'grownups', path: '/grownups', label: 'Grown-ups', icon: SlidersHorizontal },
] as const

export default function App() {
  const [route, navigate] = useRoute()
  const [health, setHealth] = useState<Health | null>(null)
  const [serverUp, setServerUp] = useState(true)
  const [instrument, setInstrument] = useState<Instrument>(DEFAULT_INSTRUMENT)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [dataVersion, setDataVersion] = useState(0)

  useEffect(() => {
    getHealth()
      .then((h) => {
        setHealth(h)
        setServerUp(true)
      })
      .catch(() => setServerUp(false))
    void loadInstrument().then((saved) => setInstrument(saved ? withColourNames(saved) : DEFAULT_INSTRUMENT))
    getSettings()
      .then(setSettings)
      .catch(() => {})
  }, [dataVersion])

  useEffect(() => {
    setSpeechLang(settings.speech_lang)
    document.documentElement.toggleAttribute('data-calm', settings.calm_mode)
  }, [settings])

  const state = {
    instrument,
    setInstrument,
    settings,
    setSettings,
    health,
    serverUp,
    navigate,
    dataVersion,
    bumpData: () => setDataVersion((v) => v + 1),
  }

  return (
    <AppContext.Provider value={state}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <header className="topbar">
          <a className="logo" href="#/" aria-label="Plink home">
            <span className="logo-word display">Plink</span>
            <span className="logo-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </a>
          <nav className="nav" aria-label="Screens">
            {NAV.map((n, i) => {
              const Icon = n.icon
              const on = route.screen === n.screen
              return (
                <a
                  key={n.screen}
                  href={`#${n.path}`}
                  className={cn('nav-link', tone(i), on && 'on')}
                  aria-current={on ? 'page' : undefined}
                >
                  <Icon aria-hidden />
                  <span>{n.label}</span>
                </a>
              )
            })}
          </nav>
        </header>

        <main id="main" className="main">
          {route.screen === 'home' && <Home />}
          {route.screen === 'play' && <Play key={`${route.arg}-${route.go}`} songId={route.arg} autostart={route.go} />}
          {route.screen === 'free' && <FreePlay songId={route.arg} />}
          {route.screen === 'songs' && <Songs adding={route.arg === 'new'} />}
          {route.screen === 'grownups' && (
            <ParentGate>
              <GrownUps tab={route.arg} />
            </ParentGate>
          )}
        </main>

        <footer className="status" aria-label="Status">
          {serverUp ? (
            <>
              <Chip t={health?.ollama ? 1 : 3} icon={<span className="dot" />}>
                Gemma {health?.ollama ? 'ready' : 'offline'}
              </Chip>
              <Chip t={health?.tabpfn ? 0 : 3} icon={<span className="dot" />}>
                TabPFN {health?.tabpfn ? 'ready' : 'off'}
              </Chip>
            </>
          ) : (
            <Chip t={3} solid>
              Local server off: free play still works
            </Chip>
          )}
          <Chip t={2} dashed icon={<Lock aria-hidden />}>
            Nothing leaves this laptop
          </Chip>
        </footer>
      </div>
    </AppContext.Provider>
  )
}
