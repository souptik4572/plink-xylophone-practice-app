import { ChevronDown, LogOut, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Account } from '../api'
import { cn } from '../theme/palette'

/** The first letter of the grown-up's name, or of their email. */
export const initial = (a: Account) => (a.display_name.trim() || a.email).charAt(0).toUpperCase()

export function Avatar({ account, large }: { account: Account; large?: boolean }) {
  return (
    <span className={cn('avatar', large && 'avatar-lg')} aria-hidden>
      {initial(account)}
    </span>
  )
}

/**
 * The grown-up's corner of the top bar. Both links lead behind the grown-up sum,
 * so she can't open the account or log herself out by tapping around.
 */
export function AccountMenu({ account, current }: { account: Account; current: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const name = account.display_name.trim()
  return (
    <div className="account-menu" ref={root}>
      <button ref={button} type="button" className={cn('account-button', current && 'on')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar account={account} />
        <span className="sr-only">Account menu for {name || account.email}</span>
        <ChevronDown aria-hidden size={18} />
      </button>
      {open && (
        <div className="account-pop">
          <p className="account-who">
            {name && <strong>{name}</strong>}
            <span className="faint small">{account.email}</span>
          </p>
          <a href="#/account" onClick={() => setOpen(false)}>
            <UserRound aria-hidden /> Account
          </a>
          <a href="#/account/logout" onClick={() => setOpen(false)}>
            <LogOut aria-hidden /> Log out
          </a>
        </div>
      )}
    </div>
  )
}
