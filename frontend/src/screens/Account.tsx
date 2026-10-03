import { CalendarDays, ChartColumn, Check, Flame, Heart, ListMusic, LogOut, Music, Save, SlidersHorizontal, Star, Trash2 } from 'lucide-react'
import { useEffect, useState, type SubmitEvent } from 'react'
import {
  ApiError,
  deleteAccount,
  getAccount,
  getProgress,
  listSessions,
  saveAccount,
  type AccountDetails,
  type Progress,
  type SessionSummary,
} from '../api'
import { useApp } from '../app/AppContext'
import { Avatar } from '../ui/AccountMenu'
import { Button, Card, Field, ScreenTitle } from '../ui/ui'

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

function Profile({ details }: { details: AccountDetails | null }) {
  const { account, setAccount, logOut, navigate } = useApp()
  const [name, setName] = useState(account?.display_name ?? '')
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState('')
  if (!account) return null
  const dirty = name.trim() !== account.display_name

  const save = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    setProblem('')
    try {
      const d = await saveAccount(name)
      setAccount({ email: d.email, display_name: d.display_name })
      setName(d.display_name)
      setSaved(true)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="settings-grid">
      <Card t={0} className="stack">
        <div className="profile-head">
          <Avatar account={account} large />
          <div className="stack-tight">
            <h3 className="card-title">{account.display_name || 'You'}</h3>
            <span className="dim">{account.email}</span>
          </div>
        </div>
        <form className="stack" onSubmit={save}>
          <Field t={0} label="Your name" hint="Shown in the account menu. Her name is in Grown-ups → Settings.">
            <input
              className="input"
              value={name}
              maxLength={40}
              placeholder="e.g. Papa"
              onChange={(e) => {
                setName(e.target.value)
                setSaved(false)
              }}
            />
          </Field>
          {problem && <p className="alert">{problem}</p>}
          <div className="row">
            <Button type="submit" variant="secondary" t={0} disabled={!dirty} icon={saved && !dirty ? <Check aria-hidden /> : <Save aria-hidden />}>
              {saved && !dirty ? 'Saved' : 'Save name'}
            </Button>
            <Button
              variant="ghost"
              t={1}
              icon={<LogOut aria-hidden />}
              onClick={() => {
                navigate('/')
                logOut()
              }}
            >
              Log out
            </Button>
          </div>
        </form>
      </Card>

      <Card t={1} border="dashed" className="stack">
        <h3 className="card-title">Account details</h3>
        {details ? (
          <dl className="account-facts">
            <dt>Email</dt>
            <dd>{details.email}</dd>
            <dt>Member since</dt>
            <dd>{date(details.created_at)}</dd>
            <dt>Her data is kept</dt>
            <dd>{details.storage === 'sqlite' ? 'On this laptop, in one SQLite file' : 'In Render Postgres, on the public demo'}</dd>
            <dt>Gemma runs</dt>
            <dd>
              <code>{details.gemma.model}</code>, {details.gemma.where === 'ollama' ? 'on this laptop through Ollama' : 'on Google’s Gemini API'}
            </dd>
          </dl>
        ) : (
          <p className="faint">Loading…</p>
        )}
      </Card>
    </div>
  )
}

function Glance() {
  const { navigate, dataVersion } = useApp()
  // undefined while loading, so an account with practice never flashes "No practice yet".
  const [progress, setProgress] = useState<Progress | null>()
  const [latest, setLatest] = useState<SessionSummary | null>(null)

  useEffect(() => {
    getProgress()
      .then(setProgress)
      .catch(() => setProgress(null))
    listSessions()
      .then((s) => setLatest(s.find((x) => x.player === 'child' && x.parent_note) ?? null))
      .catch(() => {})
  }, [dataVersion])

  const tiles = progress && [
    { t: 2, icon: Star, label: 'Stars', value: progress.stars },
    { t: 3, icon: Flame, label: 'Streak', value: progress.streak_days, unit: progress.streak_days === 1 ? ' day' : ' days' },
    { t: 1, icon: CalendarDays, label: 'Sessions', value: progress.sessions },
    { t: 0, icon: Music, label: 'Notes', value: progress.notes },
  ]

  return (
    <Card t={2} pattern="dots" className="stack-lg">
      <h3 className="card-title">Her practice at a glance</h3>
      {progress === undefined ? (
        <p className="faint">Loading…</p>
      ) : !progress || progress.sessions === 0 ? (
        <p className="dim">No practice yet. Her stars, streak and your notes from Gemma show up here after her first session.</p>
      ) : (
        <div className="stats">
          {tiles!.map(({ t, icon: Icon, label, value, unit }, i) => (
            <Card key={label} t={t} className="stat" border={i % 2 ? 'dashed' : 'solid'}>
              <p className="label">
                <Icon aria-hidden size={16} /> {label}
              </p>
              <p className="stat-value">
                {value}
                {unit && <span className="stat-unit">{unit}</span>}
              </p>
            </Card>
          ))}
        </div>
      )}
      {latest && (
        <p className="bubble tone-1 with-icon">
          <Heart aria-hidden size={20} /> {latest.parent_note}
        </p>
      )}
      <div className="row">
        <Button variant="secondary" size="sm" t={4} icon={<ChartColumn aria-hidden size={18} />} onClick={() => navigate('/grownups/progress')}>
          Progress
        </Button>
        <Button variant="secondary" size="sm" t={2} icon={<SlidersHorizontal aria-hidden size={18} />} onClick={() => navigate('/grownups/settings')}>
          Settings
        </Button>
        <Button variant="secondary" size="sm" t={3} icon={<ListMusic aria-hidden size={18} />} onClick={() => navigate('/songs')}>
          Songs
        </Button>
      </div>
    </Card>
  )
}

function DeleteAccount() {
  const { setAccount, navigate } = useApp()
  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState('')

  const remove = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    setProblem('')
    try {
      await deleteAccount(password)
      navigate('/')
      setAccount(null)
    } catch (err) {
      setProblem(err instanceof ApiError && err.status === 403 ? 'That password doesn’t match.' : 'That didn’t work. Try again.')
    }
  }

  return (
    <Card t={3} border="double" pattern="stripes" className="stack">
      <h3 className="card-title">Delete account</h3>
      <p className="dim">
        Deletes this login and everything it holds: her practice log, your notes, added songs and lessons, settings and the
        calibration. It can’t be undone.
      </p>
      {!confirming ? (
        <div className="row">
          <Button variant="secondary" t={3} icon={<Trash2 aria-hidden />} onClick={() => setConfirming(true)}>
            Delete account…
          </Button>
        </div>
      ) : (
        <form className="stack danger-zone" onSubmit={remove}>
          <Field t={3} label="Your password, to be sure">
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {problem && (
            <p className="alert" role="alert">
              {problem}
            </p>
          )}
          <div className="row">
            <Button type="submit" variant="outline" t={3} className="danger" icon={<Trash2 aria-hidden />}>
              Delete everything
            </Button>
            <Button
              variant="ghost"
              t={1}
              onClick={() => {
                setConfirming(false)
                setPassword('')
                setProblem('')
              }}
            >
              Keep it
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}

/** The grown-up's dashboard: who is logged in, where things run, and how she is doing. */
export function AccountPage() {
  const { account } = useApp()
  const [details, setDetails] = useState<AccountDetails | null>(null)

  useEffect(() => {
    getAccount()
      .then(setDetails)
      .catch(() => {})
  }, [])

  if (!account) return <p className="faint">Plink’s server is off, so there is no account to show.</p>

  return (
    <section className="screen">
      <ScreenTitle kicker="For grown-ups" t={4}>
        {account.display_name ? 'Hi,' : 'Your'} <span className="gradient-text">{account.display_name || 'account'}</span>
      </ScreenTitle>
      <Profile details={details} />
      <Glance />
      <DeleteAccount />
    </section>
  )
}

/** Logging out asks first: afterwards she can't play until a grown-up logs back in. */
export function LogOutConfirm() {
  const { account, logOut, navigate } = useApp()
  return (
    <section className="screen">
      <ScreenTitle kicker="For grown-ups" t={4}>
        Log <span className="gradient-text">out?</span>
      </ScreenTitle>
      <Card t={4} pattern="dots" className="stack login">
        <p className="dim">
          You’re logged in as <strong>{account?.email}</strong>. Once you log out, Plink needs your email and password before she can
          play again.
        </p>
        <div className="row">
          <Button
            variant="primary"
            icon={<LogOut aria-hidden />}
            onClick={() => {
              navigate('/')
              logOut()
            }}
          >
            Log out
          </Button>
          <Button variant="ghost" t={1} onClick={() => navigate('/')}>
            Stay logged in
          </Button>
        </div>
      </Card>
    </section>
  )
}
