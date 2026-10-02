import { describe, expect, it } from 'vitest'
import { newSticker, STARS_PER_STICKER, STICKERS, stickerProgress } from './stickers'

describe('stickers', () => {
  it('earns one sticker per fixed number of stars', () => {
    expect(stickerProgress(0)).toMatchObject({ earned: [], toNext: STARS_PER_STICKER, fraction: 0 })
    const p = stickerProgress(STARS_PER_STICKER * 2 + 5)
    expect(p.earned).toEqual(STICKERS.slice(0, 2))
    expect(p.next).toEqual(STICKERS[2])
    expect(p.toNext).toBe(STARS_PER_STICKER - 5)
    expect(p.fraction).toBeCloseTo(5 / STARS_PER_STICKER)
  })

  it('keeps going after the last sticker by starting the book again', () => {
    const all = STICKERS.length * STARS_PER_STICKER
    expect(stickerProgress(all).earned).toHaveLength(STICKERS.length)
    expect(stickerProgress(all).next).toEqual(STICKERS[0])
  })

  it('spots a sticker earned during a session', () => {
    expect(newSticker(STARS_PER_STICKER - 2, STARS_PER_STICKER + 1)).toEqual(STICKERS[0])
    expect(newSticker(3, 7)).toBeNull()
  })

  it('has unique stickers with names to say aloud', () => {
    expect(new Set(STICKERS.map((s) => s.emoji)).size).toBe(STICKERS.length)
    expect(STICKERS.every((s) => s.name.length > 0)).toBe(true)
  })
})
