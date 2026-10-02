import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react'
import { cn, tone } from '../theme/palette'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  /** Accent rotation index; ignored by primary, which always uses the full gradient. */
  t?: number
  icon?: ReactNode
  iconOnly?: boolean
  block?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({ variant = 'outline', size = 'md', t = 0, icon, iconOnly, block, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'btn',
        `btn-${variant}`,
        size !== 'md' && `btn-${size}`,
        iconOnly && 'btn-icon',
        block && 'btn-block',
        tone(t),
        className,
      )}
      {...rest}
    >
      {icon}
      {iconOnly ? <span className="sr-only">{children}</span> : children}
    </button>
  )
}

interface CardProps extends HTMLAttributes<HTMLElement> {
  t?: number
  pattern?: 'dots' | 'stripes' | 'checker' | 'mesh'
  border?: 'solid' | 'dashed' | 'double'
  tilt?: 'l' | 'r'
  hover?: boolean
  as?: 'div' | 'section' | 'article' | 'li' | 'aside'
}

export function Card({ t = 0, pattern, border = 'solid', tilt, hover, as: Tag = 'div', className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        'card',
        tone(t),
        pattern && `pat-${pattern}`,
        border !== 'solid' && `card-${border}`,
        tilt && `tilt-${tilt}`,
        hover && 'card-hover',
        className,
      )}
      {...rest}
    />
  )
}

export function Chip({ t = 0, solid, dashed, icon, children, className }: { t?: number; solid?: boolean; dashed?: boolean; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('chip', tone(t), solid && 'chip-solid', dashed && 'chip-dashed', className)}>
      {icon}
      {children}
    </span>
  )
}

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  t?: number
  label: ReactNode
}

export function Switch({ t = 1, label, className, ...rest }: SwitchProps) {
  return (
    <label className={cn('switch', tone(t), className)}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="switch-track" aria-hidden />
      <span>{label}</span>
    </label>
  )
}

export function Field({ t = 0, label, hint, children }: { t?: number; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className={cn('field', tone(t))}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function ScreenTitle({ kicker, children, t = 0, gradient }: { kicker?: string; children: ReactNode; t?: number; gradient?: boolean }) {
  return (
    <header className={cn('screen-title', tone(t))}>
      {kicker && <p className="label">{kicker}</p>}
      <h2 className={gradient ? 'gradient-text ts-3' : 'ts-3'}>{children}</h2>
    </header>
  )
}
