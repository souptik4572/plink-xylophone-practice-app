import { useEffect, useRef, type RefObject } from 'react'

const barOf = (target: EventTarget | null): number | null => {
  const el = (target as Element | null)?.closest?.('[data-bar]') as HTMLElement | null
  return el ? Number(el.dataset.bar) : null
}

/**
 * Pointer input for the bars: mouse, touch and pen through one code path.
 * Sound starts on pointerdown, never click. Moving across bars with the
 * button held (or the finger down) plays a glissando. Several fingers at
 * once each play their own bars.
 */
export function usePointerStrikes(container: RefObject<HTMLElement | null>, onBar: (bar: number) => void) {
  const onBarRef = useRef(onBar)
  useEffect(() => {
    onBarRef.current = onBar
  })

  useEffect(() => {
    const el = container.current
    if (!el) return
    // pointerId -> last bar it struck (-1 over a gap, so re-entering strikes again)
    const active = new Map<number, number>()

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const bar = barOf(e.target)
      if (bar === null) return
      // Touch pointers are implicitly captured by the first element; release
      // so pointerover fires on the other bars during a glissando.
      const t = e.target as Element
      if (t.hasPointerCapture?.(e.pointerId)) t.releasePointerCapture(e.pointerId)
      e.preventDefault()
      active.set(e.pointerId, bar)
      onBarRef.current(bar)
    }
    const over = (e: PointerEvent) => {
      if (!active.has(e.pointerId)) return
      const bar = barOf(e.target)
      if (bar === active.get(e.pointerId)) return
      active.set(e.pointerId, bar ?? -1)
      if (bar !== null) onBarRef.current(bar)
    }
    const up = (e: PointerEvent) => active.delete(e.pointerId)

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerover', over)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerover', over)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [container])
}
