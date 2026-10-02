import { useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react'
import { playTone } from '../audio/synth'
import { barFrequency, type Instrument } from '../instrument'
import { sparkle } from '../ui/confetti'
import { strikeBus, type BarStrike, type StrikeSource } from './barStrike'
import { barForKeyEvent, DEFAULT_KEY_LABELS, layoutKeyLabels } from './keymap'
import { usePointerStrikes } from './usePointerStrikes'

export interface XylophoneHandle {
  /** Brief strike animation on one bar. */
  flash(bar: number): void
  /**
   * `lit` glows fully with its key cap, `cue` shows faintly. With `target`,
   * the lit bar is the one to hit, and a bouncing pointer sits above it.
   */
  highlight(lit: number | null, cue: number | null, opts?: { muted?: boolean; misfit?: boolean; target?: boolean }): void
  /** Sparkles burst from a bar: a right note. */
  sparkle(bar: number): void
}

interface Props {
  instrument: Instrument
  showKeyCaps?: boolean
  /** Listen for A S D F J K L ; on the window. */
  keyboard?: boolean
  onStrike?: (s: BarStrike) => void
  ref?: Ref<XylophoneHandle>
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const STRIKE_FRAMES: Keyframe[] = [{ transform: 'translateY(4px) scale(0.98)' }, { transform: 'none' }]
const STRIKE_FRAMES_REDUCED: Keyframe[] = [{ filter: 'brightness(1.35)' }, { filter: 'none' }]

/**
 * The built-in xylophone. Strikes play sound directly in the event handler
 * and animate through refs, so nothing on the strike path waits for React.
 */
export function Xylophone({ instrument, showKeyCaps = true, keyboard = true, onStrike, ref }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const barEls = useRef<(HTMLButtonElement | null)[]>([])
  const [keyLabels, setKeyLabels] = useState(DEFAULT_KEY_LABELS)
  const onStrikeRef = useRef(onStrike)
  useEffect(() => {
    onStrikeRef.current = onStrike
  })

  useEffect(() => {
    void layoutKeyLabels().then(setKeyLabels)
  }, [])

  const flash = useCallback((bar: number) => {
    barEls.current[bar]?.animate(reducedMotion() ? STRIKE_FRAMES_REDUCED : STRIKE_FRAMES, {
      duration: 140,
      easing: 'ease-out',
    })
  }, [])

  const strike = useCallback(
    (bar: number, source: StrikeSource) => {
      playTone(barFrequency(instrument, bar))
      flash(bar)
      const s: BarStrike = { bar, source, t: performance.now() }
      strikeBus.emit(s)
      onStrikeRef.current?.(s)
    },
    [instrument, flash],
  )

  usePointerStrikes(container, (bar) => strike(bar, 'pointer'))

  useEffect(() => {
    if (!keyboard) return
    const onKey = (e: KeyboardEvent) => {
      const bar = barForKeyEvent(e, instrument.bars.length)
      if (bar === null) return
      e.preventDefault()
      strike(bar, 'keyboard')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard, instrument, strike])

  useImperativeHandle(
    ref,
    () => ({
      flash,
      sparkle(bar) {
        sparkle(barEls.current[bar], instrument.bars[bar]?.colour ?? '#fff')
      },
      highlight(lit, cue, opts = {}) {
        barEls.current.forEach((el, i) => {
          if (!el) return
          el.classList.toggle('lit', i === lit)
          el.classList.toggle('lit-muted', i === lit && !!opts.muted)
          el.classList.toggle('lit-misfit', i === lit && !!opts.misfit)
          el.classList.toggle('target', i === lit && !!opts.target)
          el.classList.toggle('cue', i === cue && i !== lit)
        })
      },
    }),
    [flash, instrument],
  )

  const n = instrument.bars.length
  return (
    <div className="xylo" ref={container} role="group" aria-label="Xylophone">
      <span className="xylo-rail" aria-hidden />
      {instrument.bars.map((b, i) => (
        <button
          key={i}
          type="button"
          data-bar={i}
          ref={(el) => {
            barEls.current[i] = el
          }}
          className="bar"
          style={{ '--bar-colour': b.colour, '--bar-len': 1 - (0.36 * i) / Math.max(1, n - 1) } as CSSProperties}
          aria-label={`Bar ${i + 1}, ${b.label}${i < keyLabels.length ? `, key ${keyLabels[i]}` : ''}`}
        >
          <span className="nail" aria-hidden />
          <span className="bar-label" aria-hidden>
            {b.label}
          </span>
          <span className="pointer" aria-hidden>
            ▼
          </span>
          {showKeyCaps && i < keyLabels.length && (
            <kbd className="keycap" aria-hidden>
              {keyLabels[i]}
            </kbd>
          )}
          <span className="nail" aria-hidden />
        </button>
      ))}
    </div>
  )
}
