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
    /**
     * Below any toy xylophone's lowest bar. Table knocks, footsteps, hum and the
     * low end of voices are filtered out before anything listens.
     */
    highPassHz: 250,
    /** A strike is a frame louder than max(noiseMult × the room's level, minRms)... */
    noiseMult: 4,
    minRms: 0.01,
    /**
     * ...that is also this much louder than the frame before. Without it a
     * long-ringing bar re-triggers once the refractory period ends; a decaying
     * tail never rises, while a new strike on a still-ringing bar does.
     */
    riseRatio: 1.3,
    refractoryMs: 150,
    /**
     * The room's level is re-measured as it plays: this quiet end of the last
     * few seconds. A TV or a fan switched on after calibration raises the bar.
     */
    floorWindowS: 3,
    floorPercentile: 0.2,
    /** Skip the mallet click before taking the spectrum. */
    skipMs: 20,
    /** The spectrum's window, rounded to a power of two at the device's sample rate. */
    windowMs: 85,
    minHz: 200,
    maxHz: 6000,
    /** Spectra live on a musical scale, the same at 44.1 or 48 kHz, so a calibration works on any device. */
    bandsPerSemitone: 4,
    /** A bar's pitch is its lowest peak at least this share of the strongest. */
    pitchPeakShare: 0.5,
    /**
     * A struck bar peaks at the mallet and then only decays: the window's level
     * is between these shares of the attack's (0.44-0.87 measured on synthetic
     * wooden and metal bars). A clap, knock or key click has died away (≤0.31);
     * a voice swells after it starts (2.0-3.2).
     */
    minSustain: 0.15,
    maxSustain: 1.1,
    /**
     * A bar is a few partials: at least this share of its energy lies within half
     * a semitone of its three strongest peaks (≥0.96 on synthetic bars, even soft
     * ones in a noisy room; ≤0.77 for an adult's voice).
     */
    tonalPeaks: 3,
    tonalReachSemitones: 0.5,
    minPeakShare: 0.85,
    /** Same bar scores ≥0.86 even 1% off its calibrated pitch; another bar ≤0.43; a note between bars ≤0.33. */
    minScore: 0.75,
    minMargin: 0.15,
    strikesPerBar: 3,
    /** A bar's three calibration strikes must each be this close to their average... */
    calibrateConsistency: 0.85,
    /** ...agree on pitch within this many semitones... */
    pitchAgreeSemitones: 1,
    /** ...and the bar no closer than this to an earlier bar, or it is redone. */
    calibrateDistinct: 0.92,
    /**
     * Bars are calibrated low to high, so each must sound higher than the last.
     * A step this many semitones bigger than the instrument's own step means a
     * bar was skipped (toy xylophones are often out of tune, so it is generous).
     */
    skipSlackSemitones: 1.5,
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
    /** Pause between Plink's demonstration and her turn. */
    afterDemoMs: 500,
    /** How long a happy or hint face stays before the mascot goes back to waiting. */
    moodMs: 1200,
    /**
     * Per-note help from TabPFN's prediction for each note: help comes sooner
     * on notes she is likely to miss and holds back on ones she'll get.
     */
    adaptive: {
      trickyBelow: 0.6,
      easyFrom: 0.88,
      trickyPromptFactor: 0.35,
      easyPromptFactor: 1.6,
      trickyHintAfterMs: 4000,
      easyHintAfterMs: 11000,
      /** On a tricky note Plink says the colour, even at "some help". */
      sayColourWhenTricky: true,
    },
    /**
     * Help levels (fading prompts). Lots: errorless, only the target sounds, its
     * colour is spoken. Some: the spec's wait mode. Little: from memory, the glow
     * appears only after a pause or a miss.
     */
    help: {
      lots: { demoTempo: 0.75, glowAtStart: true, targetTone: true, sayColour: true, onlyTarget: true, promptAfterMs: 0 },
      some: { demoTempo: 0.85, glowAtStart: true, targetTone: true, sayColour: false, onlyTarget: false, promptAfterMs: 0 },
      little: { demoTempo: 1, glowAtStart: false, targetTone: false, sayColour: false, onlyTarget: false, promptAfterMs: 3500 },
    },
  },

  /** Add a song, play it in (spec 7.7). */
  addSong: {
    /** Strikes closer than this are one bounce of the mallet, not two notes. */
    minGapMs: 80,
    maxBeats: 4,
  },

  /** Sing or hum it (spec 7.7, route 2): Basic Pitch, then cleaning. */
  hum: {
    maxSeconds: 20,
    /** Basic Pitch only accepts 22,050 Hz mono; Plink resamples before calling it. */
    modelSampleRate: 22050,
    modelUrl: '/basic-pitch/model.json',
    /** Basic Pitch's own defaults (onset 0.5, frame 0.3, ~128 ms minimum). */
    onsetThresh: 0.5,
    frameThresh: 0.3,
    minNoteFrames: 11,
    /** Drop notes shorter than this (spec: 120 ms). */
    minNoteS: 0.12,
    /** Loudness envelope frame, for telling a held note from a sung repeat. */
    envelopeFrameS: 0.01,
    /**
     * Two same-pitch notes are one held note unless the voice dips below this
     * share of its level around the boundary (a repeat is re-attacked).
     */
    dipRatio: 0.55,
    dipBeforeS: 0.08,
    dipAfterS: 0.04,
    /** A hummed tune stays within about an octave; notes further from its median pitch are noise. */
    maxFromMedianSemitones: 14,
    /** Notes quieter than this share of the typical note are ghosts (overtones, room). */
    minRelativeAmp: 0.5,
  },
} as const
