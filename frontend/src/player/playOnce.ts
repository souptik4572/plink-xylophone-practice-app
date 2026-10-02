import { audioNow, getAudioContext, playTone } from '../audio/synth'
import { barFrequency, type Instrument } from '../instrument'
import { strikeBus } from './barStrike'
import { PlaybackDriver, type ReplayNote } from './playback'
import type { XylophoneHandle } from './Xylophone'

/** Plays notes once on the built-in xylophone, lighting bars in time. Resolves when done. */
export function playOnce(notes: ReplayNote[], instrument: Instrument, xylo: XylophoneHandle | null): Promise<void> {
  getAudioContext()
  return new Promise((resolve) => {
    const driver = new PlaybackDriver(
      notes,
      {
        now: audioNow,
        sound: (bar, when) => playTone(barFrequency(instrument, bar), when),
        onNote: (n) => strikeBus.emit({ bar: n.bar, source: 'replay', t: performance.now() }),
      },
      (h, status) => {
        const lit = h.current === null ? null : notes[h.current]
        xylo?.highlight(lit?.bar ?? null, null, { muted: lit?.muted, misfit: lit?.misfit })
        if (status === 'ended') {
          driver.dispose()
          resolve()
        }
      },
    )
    driver.engine.play()
  })
}
