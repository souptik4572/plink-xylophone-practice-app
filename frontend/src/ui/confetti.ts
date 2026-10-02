import { ACCENTS } from '../theme/palette'

const quiet = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.hasAttribute('data-calm')

/**
 * A burst of confetti from a point (defaults to screen centre). Plain DOM
 * and the Web Animations API: no React state, nothing left behind.
 */
export function confetti(opts: { x?: number; y?: number; count?: number } = {}) {
  if (quiet()) return
  const x = opts.x ?? window.innerWidth / 2
  const y = opts.y ?? window.innerHeight / 3
  const count = opts.count ?? 70
  const layer = document.createElement('div')
  layer.className = 'confetti-layer'
  layer.setAttribute('aria-hidden', 'true')
  document.body.append(layer)

  let left = count
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i')
    const size = 8 + Math.random() * 10
    const round = Math.random() < 0.35
    p.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${round ? size : size * 0.45}px;background:${ACCENTS[i % 5]};border-radius:${round ? '50%' : '2px'}`
    layer.append(p)
    const angle = Math.random() * Math.PI * 2
    const speed = 160 + Math.random() * 320
    const dx = Math.cos(angle) * speed
    const dy = Math.sin(angle) * speed - 220
    const spin = (Math.random() - 0.5) * 1440
    p.animate(
      [
        { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${dy * 0.6}px)) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 520}px)) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: 1300 + Math.random() * 700, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
    ).onfinish = () => {
      if (--left === 0) layer.remove()
    }
  }
}

/** A small sparkle at an element, for each right note. */
export function sparkle(el: Element | null | undefined, colour: string) {
  if (!el || quiet()) return
  const r = el.getBoundingClientRect()
  const layer = document.createElement('div')
  layer.className = 'confetti-layer'
  layer.setAttribute('aria-hidden', 'true')
  document.body.append(layer)
  const n = 10
  let left = n
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i')
    p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height * 0.25}px;width:9px;height:9px;border-radius:50%;background:${i % 2 ? colour : ACCENTS[i % 5]}`
    layer.append(p)
    const a = (i / n) * Math.PI * 2
    p.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * 70}px), calc(-50% + ${Math.sin(a) * 70}px)) scale(0.2)`, opacity: 0 },
      ],
      { duration: 550, easing: 'ease-out' },
    ).onfinish = () => {
      if (--left === 0) layer.remove()
    }
  }
}
