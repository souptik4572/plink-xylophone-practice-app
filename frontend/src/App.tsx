import { House, ListMusic, Lock, Piano, Play as PlayIcon, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  getHealth,
  getSettings,
  loadInstrument,
  logOut,
  refreshLogin,
  whenSignedOut,
  type Account,
  type Health,
  type Settings,
} from './api'
import { AppContext, DEFAULT_SETTINGS } from './app/AppContext'
import { useRoute } from './app/route'
import { DEFAULT_INSTRUMENT, withColourNames, type Instrument } from './instrument'
import { AccountPage, LogOutConfirm } from './screens/Account'
import { FreePlay } from './screens/FreePlay'
import { Home } from './screens/Home'
import { Login } from './screens/Login'
import { ParentGate } from './kids/ParentGate'
import { GrownUps } from './screens/Parent'
import { Play } from './screens/Play'
import { Songs } from './screens/Songs'
import { cn, tone } from './theme/palette'
import { AccountMenu } from './ui/AccountMenu'
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
  const [account, setAccount] = useState<Account | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    whenSignedOut(() => setAccount(null))
    // A refresh cookie from an earlier visit logs straight back in.
    refreshLogin()
      .then(setAccount)
      .catch(() => setServerUp(false))
      .finally(() => setChecked(true))
  }, [])

  useEffect(() => {
    getHealth()
      .then((h) => {
        setHealth(h)
        setServerUp(true)
      })
      .catch(() => setServerUp(false))
    if (!account) return
    void loadInstrument().then((saved) => setInstrument(saved ? withColourNames(saved) : DEFAULT_INSTRUMENT))
    getSettings()
      .then(setSettings)
      .catch(() => {})
  }, [dataVersion, account])

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
    account,
    setAccount,
    // Back to the login screen even if the server can't be reached.
    logOut: () => void logOut().catch(() => {}).finally(() => setAccount(null)),
  }

  if (!checked) return null
  // Without the server there is no login to check, but free play still works.
  const signedOut = serverUp && !account

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
          {!signedOut && (
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
          )}
          {!signedOut && account && <AccountMenu account={account} current={route.screen === 'account'} />}
        </header>

        <main id="main" className="main">
          {signedOut ? (
            <Login onSignedIn={setAccount} />
          ) : (
            <>
              {route.screen === 'home' && <Home />}
              {route.screen === 'play' && <Play key={`${route.arg}-${route.go}`} songId={route.arg} autostart={route.go} />}
              {route.screen === 'free' && <FreePlay songId={route.arg} />}
              {route.screen === 'songs' && <Songs adding={route.arg === 'new'} />}
              {route.screen === 'grownups' && (
                <ParentGate>
                  <GrownUps tab={route.arg} />
                </ParentGate>
              )}
              {route.screen === 'account' && <ParentGate>{route.arg === 'logout' ? <LogOutConfirm /> : <AccountPage />}</ParentGate>}
            </>
          )}
        </main>

        <footer className="status" aria-label="Status">
          {serverUp ? (
            <>
              <Chip t={health?.gemma ? 1 : 3} icon={<span className="dot" />}>
                Gemma {health?.gemma ? 'ready' : 'offline'}
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
