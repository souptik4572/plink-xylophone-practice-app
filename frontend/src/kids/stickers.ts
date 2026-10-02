// Her sticker book: one star per note right first time, a sticker every
// STARS_PER_STICKER stars. Derived from the attempt log, so nothing extra is stored.

export interface Sticker {
  emoji: string
  name: string
}

export const STARS_PER_STICKER = 15

export const STICKERS: Sticker[] = [
  { emoji: '🐱', name: 'a kitten' },
  { emoji: '🦄', name: 'a unicorn' },
  { emoji: '🌈', name: 'a rainbow' },
  { emoji: '🐢', name: 'a turtle' },
  { emoji: '🚀', name: 'a rocket' },
  { emoji: '🦋', name: 'a butterfly' },
  { emoji: '🐼', name: 'a panda' },
  { emoji: '🍓', name: 'a strawberry' },
  { emoji: '🐳', name: 'a whale' },
  { emoji: '🌻', name: 'a sunflower' },
  { emoji: '🦖', name: 'a dinosaur' },
  { emoji: '🎈', name: 'a balloon' },
  { emoji: '🐝', name: 'a bee' },
  { emoji: '🍩', name: 'a doughnut' },
  { emoji: '🦊', name: 'a fox' },
  { emoji: '⭐', name: 'a golden star' },
]

export function stickerProgress(stars: number) {
  const count = Math.floor(stars / STARS_PER_STICKER)
  const into = stars % STARS_PER_STICKER
  return {
    // Past the last sticker the book starts again, so there is always a next one.
    earned: STICKERS.slice(0, Math.min(count, STICKERS.length)),
    next: STICKERS[count % STICKERS.length],
    toNext: STARS_PER_STICKER - into,
    fraction: into / STARS_PER_STICKER,
  }
}

/** The sticker earned while her total went from `before` to `after`, if any. */
export function newSticker(before: number, after: number): Sticker | null {
  const a = Math.floor(before / STARS_PER_STICKER)
  const b = Math.floor(after / STARS_PER_STICKER)
  return b > a ? STICKERS[(b - 1) % STICKERS.length] : null
}
