// Spoken prompts through the browser's own speech engine: offline, no setup.

let speaking = false

export function say(text: string) {
  if (!('speechSynthesis' in window)) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 0.95
  u.pitch = 1.1
  u.onstart = () => (speaking = true)
  u.onend = u.onerror = () => (speaking = false)
  speechSynthesis.speak(u)
}

/** The mic treats the app's own voice like its own tones: it does not listen while speaking. */
export const isSpeaking = () => speaking || ('speechSynthesis' in window && speechSynthesis.speaking)

/** Used until Gemma writes her own praise lines. */
export const DEFAULT_PRAISE = ['Well done!', 'Yay!', 'Brilliant!', 'You did it!', 'Super!', 'Lovely playing!']

export const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
