import type { CSSProperties } from 'react'
import { cn, tone } from '../theme/palette'

const SHAPES = {
  star: <path d="M50 4l13 31 33 3-25 22 8 33-29-18-29 18 8-33L4 38l33-3z" />,
  sparkle: <path d="M50 0c4 30 16 42 50 50-34 8-46 20-50 50-4-30-16-42-50-50 34-8 46-20 50-50z" />,
  circle: <circle cx="50" cy="50" r="40" fill="none" strokeWidth="14" />,
  square: <rect x="14" y="14" width="72" height="72" rx="10" transform="rotate(12 50 50)" />,
  squiggle: (
    <path d="M4 60c12-30 24-30 32 0s20 30 32 0 20-30 28 0" fill="none" strokeWidth="12" strokeLinecap="round" />
  ),
  note: <path d="M62 8v56a18 18 0 1 1-10-16V20l36-10v12z" />,
} as const

export interface DecoItem {
  shape?: keyof typeof SHAPES
  emoji?: string
  /** Position as CSS values, e.g. { top: '10%', left: '5%' }. */
  at: CSSProperties
  size: number
  t: number
  motion?: 'float' | 'float-reverse' | 'spin-slow' | 'wiggle' | 'bounce'
  delay?: number
  /** Hidden below tablet width, to thin decorations on phones. */
  wide?: boolean
}

/** Floating shapes and emoji, purely decorative: hidden from screen readers and in calm mode. */
export function Deco({ items }: { items: DecoItem[] }) {
  return (
    <div className="deco-layer" aria-hidden>
      {items.map((d, i) => (
        <span
          key={i}
          className={cn('deco', tone(d.t), d.motion && `animate-${d.motion}`, d.wide && 'deco-wide')}
          style={{
            ...d.at,
            width: d.size,
            height: d.size,
            fontSize: d.size * 0.9,
            animationDelay: d.delay ? `${d.delay}s` : undefined,
            color: 'var(--a)',
          }}
        >
          {d.emoji ?? (
            <svg viewBox="0 0 100 100" fill="currentColor" stroke="currentColor">
              {SHAPES[d.shape ?? 'star']}
            </svg>
          )}
        </span>
      ))}
    </div>
  )
}

/** Oversized outline word behind a section, bleeding off the edge. */
export function BigWord({ word, t = 0, at }: { word: string; t?: number; at: CSSProperties }) {
  return (
    <span className={cn('bigword', tone(t))} style={at} aria-hidden>
      {word}
    </span>
  )
}
