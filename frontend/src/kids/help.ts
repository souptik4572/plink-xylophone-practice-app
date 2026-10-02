import type { HelpLevel } from '../play/phraseRun'

export const HELP: { level: HelpLevel; emoji: string; title: string; text: string }[] = [
  { level: 'lots', emoji: '🌱', title: 'Lots of help', text: 'Only the glowing bar plays, and Plink says each colour. No mistakes possible.' },
  { level: 'some', emoji: '🌿', title: 'Some help', text: 'The next bar glows. Plink gives a hint if she gets stuck.' },
  { level: 'little', emoji: '🌳', title: 'Little help', text: 'She plays from memory. The bar glows only if she needs it.' },
]

export interface HelpAdvice {
  suggest: 'less' | 'more' | 'stay' | 'try'
  level: HelpLevel
  now: number
  then: number | null
}

const pct = (p: number) => `${Math.round(p * 100)}%`

/** TabPFN's help-level advice, in a sentence for the grown-up. */
export function adviceText(a: HelpAdvice): string {
  const h = HELP.find((x) => x.level === a.level)!
  const name = `${h.emoji} ${h.title}`
  switch (a.suggest) {
    case 'less':
      return `Ready for ${name}: TabPFN expects ${pct(a.then!)} right first time with less help.`
    case 'try':
      return `Doing well (${pct(a.now)} expected). Try ${name} once, so TabPFN can learn how she does with it.`
    case 'more':
      return `${name} would make this easier: TabPFN expects only ${pct(a.now)} right first time now.`
    default:
      return `${name} is right for now: TabPFN expects ${pct(a.now)} right first time.`
  }
}
