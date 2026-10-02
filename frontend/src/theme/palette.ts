/** Colour rotation (index % 5), matching the .tone-N classes in tokens.css. */
export const tone = (i: number) => `tone-${((i % 5) + 5) % 5}`

/** The five accents, for the few places that need a colour in script (confetti). */
export const ACCENTS = ['#ff3af2', '#00f5d4', '#ffe600', '#ff6b35', '#7b2fff']

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')
