import { describe, expect, it } from 'vitest'
import { barForCode, barForKeyEvent, DEFAULT_KEY_LABELS, KEY_CODES, type KeyLike } from './keymap'

const key = (code: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  code,
  repeat: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target: null,
  ...extra,
})

describe('keymap', () => {
  it('maps the home row to bars 0..7, low to high', () => {
    expect(KEY_CODES).toEqual(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'])
    expect(KEY_CODES.map(barForCode)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(DEFAULT_KEY_LABELS).toEqual(['A', 'S', 'D', 'F', 'J', 'K', 'L', ';'])
  })

  it('ignores keys outside the home row, including G and H', () => {
    for (const code of ['KeyG', 'KeyH', 'Space', 'Enter', 'Quote']) expect(barForCode(code)).toBeNull()
  })

  it('matches on physical code, so the label a layout prints does not matter', () => {
    // On AZERTY the KeyA position types "q"; it is still bar 0.
    expect(barForKeyEvent(key('KeyA'))).toBe(0)
  })

  it('ignores auto-repeat', () => {
    expect(barForKeyEvent(key('KeyD', { repeat: true }))).toBeNull()
  })

  it('leaves browser shortcuts alone', () => {
    expect(barForKeyEvent(key('KeyS', { metaKey: true }))).toBeNull()
    expect(barForKeyEvent(key('KeyS', { ctrlKey: true }))).toBeNull()
    expect(barForKeyEvent(key('KeyS', { altKey: true }))).toBeNull()
  })

  it('ignores keys while a text field has focus', () => {
    expect(barForKeyEvent(key('KeyA', { target: { tagName: 'INPUT', type: 'text' } }))).toBeNull()
    expect(barForKeyEvent(key('KeyA', { target: { tagName: 'TEXTAREA' } }))).toBeNull()
    expect(barForKeyEvent(key('KeyA', { target: { tagName: 'DIV', isContentEditable: true } }))).toBeNull()
  })

  it('still plays when a checkbox or button has focus', () => {
    expect(barForKeyEvent(key('KeyA', { target: { tagName: 'INPUT', type: 'checkbox' } }))).toBe(0)
    expect(barForKeyEvent(key('KeyF', { target: { tagName: 'BUTTON' } }))).toBe(3)
  })

  it('drops keys beyond a smaller instrument', () => {
    expect(barForKeyEvent(key('Semicolon'), 6)).toBeNull()
    expect(barForKeyEvent(key('KeyK'), 6)).toBe(5)
  })
})
