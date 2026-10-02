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

  /** Microphone note detection (spec 7.1, 7.2). */
  detection: {
    noiseMeasureS: 1,
    frameMs: 10,
    /** A strike is a frame louder than max(noiseMult × noise floor, minRms)... */
    noiseMult: 4,
    minRms: 0.01,
    /**
     * ...that is also this much louder than the frame before. Without it a
     * long-ringing bar re-triggers once the refractory period ends; a decaying
     * tail never rises, while a new strike on a still-ringing bar does.
     */
    riseRatio: 1.3,
    refractoryMs: 150,
    /** Skip the mallet click before taking the spectrum. */
    skipMs: 20,
    fftSize: 4096,
    minHz: 200,
    maxHz: 6000,
    minScore: 0.8,
    minMargin: 0.05,
    strikesPerBar: 3,
    /** A bar's three calibration strikes must each be this close to their average... */
    calibrateConsistency: 0.85,
    /** ...and the bar no closer than this to an earlier bar, or it is redone. */
    calibrateDistinct: 0.92,
    /** The mic stays deaf this long after the app's own sound ends (room echo). */
    selfMuteTailS: 0.1,
    selfTestStrikesPerBar: 5,
    /** Spec gate: 36 of 40 correct. */
    selfTestGate: 36,
  },

  /** Play screen, wait mode (spec 7.4). */
  play: {
    hintAfterWrong: 3,
    hintAfterSilenceMs: 8000,
    /** Pause after a right strike before the next target sounds, so the two don't clash. */
    nextNoteDelayMs: 450,
  },

  /** Add a song, play it in (spec 7.7). */
  addSong: {
    /** Strikes closer than this are one bounce of the mallet, not two notes. */
    minGapMs: 80,
    maxBeats: 4,
  },
} as const
