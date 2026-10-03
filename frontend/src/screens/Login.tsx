import { LogIn, UserPlus } from 'lucide-react'
import { useState, type SubmitEvent } from 'react'
import { ApiError, logIn, signUp, type Account } from '../api'
import { Button, Card, Field, ScreenTitle } from '../ui/ui'

const PROBLEMS: Record<number, string> = {
  401: 'That email and password don’t match.',
  409: 'There’s already an account with that email. Log in instead.',
  422: 'Check the email, and use at least 8 characters for the password.',
}

/** The grown-up's way in: one account per family, email and password only. */
export function Login({ onSignedIn }: { onSignedIn: (a: Account) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const signingUp = mode === 'signup'

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    setProblem('')
    setBusy(true)
    try {
      onSignedIn(await (signingUp ? signUp : logIn)(email, password))
    } catch (err) {
      setProblem(
        err instanceof ApiError ? (PROBLEMS[err.status] ?? `Something went wrong (${err.status}). Try again.`) : 'Plink’s server isn’t answering. Is it running?',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="screen">
      <ScreenTitle kicker="For grown-ups" t={4}>
        {signingUp ? 'Make an' : 'Welcome'} <span className="gradient-text">{signingUp ? 'account' : 'back'}</span>
      </ScreenTitle>
      <Card t={4} pattern="dots" className="stack login">
        <p className="dim">
          {signingUp
            ? 'One account per family. Her songs, stars, practice and settings stay with it.'
            : 'Log in to pick up her songs, stars and practice where she left off.'}
        </p>
        <form className="stack" onSubmit={submit}>
          <Field t={0} label="Email">
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field t={1} label="Password" hint={signingUp ? 'At least 8 characters.' : undefined}>
            <input
              className="input"
              type="password"
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {problem && (
            <p className="alert" role="alert">
              {problem}
            </p>
          )}
          <div className="row">
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              icon={busy ? <span className="spinner" aria-hidden /> : signingUp ? <UserPlus aria-hidden /> : <LogIn aria-hidden />}
            >
              {signingUp ? 'Make my account' : 'Log in'}
            </Button>
          </div>
        </form>
        <div className="row">
          <Button
            variant="ghost"
            t={1}
            onClick={() => {
              setMode(signingUp ? 'login' : 'signup')
              setProblem('')
            }}
          >
            {signingUp ? 'Already have one? Log in' : 'New here? Make an account'}
          </Button>
        </div>
      </Card>
    </section>
  )
}
