import { audioConfig } from './audio/audioConfig'

/** One bar of her xylophone, low to high (spec 7.5). */
export interface Bar {
  label: string
  colour: string
  /** Spoken in hints: "Try the red one". */
  colour_name?: string
  semitone_offset: number
  /** Calibrated spectrum, set on the Calibrate screen. */
  template?: number[]
}

export interface Instrument {
  bars: Bar[]
  /** Room noise RMS measured at calibration. */
  noise_floor?: number
}

export const isCalibrated = (inst: Instrument) =>
  inst.noise_floor !== undefined && inst.bars.every((b) => b.template?.length)

/** Eight bars, C major, C to high C, in the usual toy-xylophone rainbow. */
export const DEFAULT_INSTRUMENT: Instrument = {
  bars: [
    { label: 'C', colour: '#e5383b', colour_name: 'red', semitone_offset: 0 },
    { label: 'D', colour: '#f77f00', colour_name: 'orange', semitone_offset: 2 },
    { label: 'E', colour: '#fcbf49', colour_name: 'yellow', semitone_offset: 4 },
    { label: 'F', colour: '#5cb85c', colour_name: 'green', semitone_offset: 5 },
    { label: 'G', colour: '#2ec4b6', colour_name: 'turquoise', semitone_offset: 7 },
    { label: 'A', colour: '#3a86ff', colour_name: 'blue', semitone_offset: 9 },
    { label: 'B', colour: '#8e5bd8', colour_name: 'purple', semitone_offset: 11 },
    { label: 'C′', colour: '#e05297', colour_name: 'pink', semitone_offset: 12 },
  ],
}

export function barFrequency(instrument: Instrument, bar: number): number {
  return audioConfig.synth.baseFreqHz * 2 ** (instrument.bars[bar].semitone_offset / 12)
}
