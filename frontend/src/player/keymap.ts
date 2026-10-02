// Home-row keys, low to high (spec 7.3). Matched on event.code so the
// mapping follows physical key position on any keyboard layout.

export const KEY_CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'] as const
export const DEFAULT_KEY_LABELS = ['A', 'S', 'D', 'F', 'J', 'K', 'L', ';']

/** The parts of a KeyboardEvent the mapping looks at; plain objects work in tests. */
export interface KeyLike {
  code: string
  repeat: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  target: EventTarget | { tagName?: string; type?: string; isContentEditable?: boolean } | null
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'])

export function barForCode(code: string): number | null {
  const i = (KEY_CODES as readonly string[]).indexOf(code)
  return i < 0 ? null : i
}

export function isTextEntry(target: KeyLike['target']): boolean {
  if (!target || typeof target !== 'object') return false
  const t = target as { tagName?: string; type?: string; isContentEditable?: boolean }
  if (t.isContentEditable) return true
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true
  return t.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((t.type ?? 'text').toLowerCase())
}

/** The bar a key press should strike, or null if it should be ignored. */
export function barForKeyEvent(e: KeyLike, barCount: number = KEY_CODES.length): number | null {
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || isTextEntry(e.target)) return null
  const bar = barForCode(e.code)
  return bar !== null && bar < barCount ? bar : null
}

interface KeyboardWithLayout {
  getLayoutMap(): Promise<Map<string, string>>
}

/** Key-cap labels from the user's layout where the browser can tell us, else the QWERTY defaults. */
export async function layoutKeyLabels(): Promise<string[]> {
  const kb = (navigator as Navigator & { keyboard?: KeyboardWithLayout }).keyboard
  if (!kb?.getLayoutMap) return DEFAULT_KEY_LABELS
  try {
    const map = await kb.getLayoutMap()
    return KEY_CODES.map((code, i) => map.get(code)?.toUpperCase() ?? DEFAULT_KEY_LABELS[i])
  } catch {
    return DEFAULT_KEY_LABELS
  }
}
