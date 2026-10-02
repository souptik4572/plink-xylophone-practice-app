// Every audio threshold and timing constant lives here, never inline.

export const audioConfig = {
  /** Built-in xylophone voice (spec 7.3, Sound). */
  synth: {
    /** Pitch of the lowest bar. Toy xylophones sit around C5–C6; only relative pitch matters. */
    baseFreqHz: 523.25,
    attackS: 0.002,
    decayS: 0.5,
    /** A quieter, faster-decaying upper partial gives the wooden "tok". */
    partialRatio: 3,
    partialGain: 0.22,
    partialDecayS: 0.18,
    /** A few ms of band-passed noise for the mallet click. */
    clickMs: 8,
    clickFreqHz: 3500,
    clickGain: 0.35,
    masterGain: 0.55,
  },

  /** Replay engine (spec 7.3, Replay). */
  playback: {
    /** How far ahead notes are put on the AudioContext clock. */
    lookaheadS: 0.1,
    /** How often the scheduler tops up the lookahead window. */
    pumpIntervalMs: 25,
    /** Delay before the first note, so it is never scheduled in the past. */
    startLeadS: 0.06,
    /** Tempo of built-in tunes at 1×. */
    bpm: 90,
    /** Share of a note's length that its bar stays lit, so repeated notes visibly re-strike. */
    litFraction: 0.85,
    /** How long the last strike of an attempt stays lit. */
    attemptTailMs: 500,
    /** Silence between passes when looping. */
    loopGapMs: 800,
    tempos: [0.5, 0.75, 1] as const,
  },
} as const
