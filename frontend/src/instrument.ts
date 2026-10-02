import { audioConfig } from './audio/audioConfig'

/** One bar of her xylophone, low to high (spec 7.5). */
export interface Bar {
  label: string
  colour: string
  semitone_offset: number
  /** Calibrated spectrum, set on the Calibrate screen. */
  template?: number[]
}

export interface Instrument {
  bars: Bar[]
}

/** Eight bars, C major, C to high C, in the usual toy-xylophone rainbow. */
export const DEFAULT_INSTRUMENT: Instrument = {
  bars: [
    { label: 'C', colour: '#e5383b', semitone_offset: 0 },
    { label: 'D', colour: '#f77f00', semitone_offset: 2 },
    { label: 'E', colour: '#fcbf49', semitone_offset: 4 },
    { label: 'F', colour: '#5cb85c', semitone_offset: 5 },
    { label: 'G', colour: '#2ec4b6', semitone_offset: 7 },
    { label: 'A', colour: '#3a86ff', semitone_offset: 9 },
    { label: 'B', colour: '#8e5bd8', semitone_offset: 11 },
    { label: 'C′', colour: '#e05297', semitone_offset: 12 },
  ],
}

export function barFrequency(instrument: Instrument, bar: number): number {
  return audioConfig.synth.baseFreqHz * 2 ** (instrument.bars[bar].semitone_offset / 12)
}
