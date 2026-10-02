// The one input stream (spec 7.3). The mic detector, the built-in player and
// the replay engine all emit BarStrike; Play and Add a song consume it without
// caring where a strike came from. Replay strikes are seen and heard, never scored.

export type StrikeSource = 'mic' | 'pointer' | 'keyboard' | 'replay'

export interface BarStrike {
  bar: number
  source: StrikeSource
  /** performance.now() at the strike, in ms. */
  t: number
}

type Listener = (s: BarStrike) => void

const listeners = new Set<Listener>()

export const strikeBus = {
  emit(s: BarStrike) {
    for (const l of listeners) l(s)
  },
  /** Returns an unsubscribe function, so it can be returned from useEffect. */
  subscribe(l: Listener): () => void {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}

export const isScorable = (s: BarStrike) => s.source !== 'replay'
