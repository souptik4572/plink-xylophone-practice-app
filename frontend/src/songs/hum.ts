import { audioConfig } from '../audio/audioConfig'
import { openMic } from '../audio/mic'
import { midiToName } from './notation'
import { snapToBeats } from './recordTune'

const cfg = audioConfig.hum

/** A note as Basic Pitch heard it. */
export interface HeardNote {
  midi: number
  startS: number
  durS: number
  amp: number
}

/** The take's loudness, as RMS per short frame. */
export interface Envelope {
  frameS: number
  rms: ArrayLike<number>
}

const end = (n: HeardNote) => n.startS + n.durS

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function envelope(samples: ArrayLike<number>, sampleRate: number): Envelope {
  const frameS = cfg.envelopeFrameS
  const len = Math.round(sampleRate * frameS)
  const rms = new Array<number>(Math.floor(samples.length / len))
  for (let f = 0; f < rms.length; f++) {
    let sum = 0
    for (let i = f * len; i < (f + 1) * len; i++) sum += samples[i] * samples[i]
    rms[f] = Math.sqrt(sum / len)
  }
  return { frameS, rms }
}

function level(env: Envelope, fromS: number, toS: number, pick: (xs: number[]) => number) {
  const a = Math.max(0, Math.floor(fromS / env.frameS))
  const b = Math.min(env.rms.length, Math.ceil(toS / env.frameS))
  const xs = Array.from({ length: Math.max(0, b - a) }, (_, i) => env.rms[a + i])
  return xs.length ? pick(xs) : 0
}

/** Did the voice dip between two notes, as it does when a note is sung again? */
function dipBetween(env: Envelope, a: HeardNote, b: HeardNote) {
  const ref = (level(env, a.startS, end(a), median) + level(env, b.startS, end(b), median)) / 2
  const low = level(env, b.startS - cfg.dipBeforeS, b.startS + cfg.dipAfterS, (xs) => Math.min(...xs))
  return low < cfg.dipRatio * ref
}

/**
 * Spec 7.7 cleaning, for a hum (one melodic line):
 * - drop far-off pitches and quiet ghosts (overtones, room rumble);
 * - keep the loudest note at each moment;
 * - re-join pieces of one held note: Basic Pitch splits long notes with
 *   vibrato into same-pitch fragments. Spec deviation: "merge immediate
 *   repeats" would also merge a sung "C C", which arrives touching, so pieces
 *   join only if the voice did not dip between them (needs the envelope), or
 *   if Basic Pitch reported one note twice (overlapping);
 * - drop notes under 120 ms, after joining, so fragments are not lost.
 */
export function cleanNotes(notes: HeardNote[], env?: Envelope): HeardNote[] {
  if (notes.length === 0) return []
  const mid = median(notes.map((n) => n.midi))
  const loud = median(notes.map((n) => n.amp))
  const sorted = notes
    .filter((n) => Math.abs(n.midi - mid) <= cfg.maxFromMedianSemitones && n.amp >= cfg.minRelativeAmp * loud)
    .sort((a, b) => a.startS - b.startS || b.amp - a.amp)
  const line: HeardNote[] = []
  for (const n of sorted) {
    const last = line.at(-1)
    if (last && n.midi === last.midi && n.startS < end(last)) {
      last.durS = Math.max(end(last), end(n)) - last.startS
      last.amp = Math.max(last.amp, n.amp)
    } else if (!last || n.startS >= end(last)) {
      line.push({ ...n })
    } else if (n.amp > last.amp) {
      last.durS = n.startS - last.startS
      if (last.durS <= 0) line.pop()
      line.push({ ...n })
    } else if (end(n) > end(last)) {
      line.push({ ...n, startS: end(last), durS: end(n) - end(last) })
    }
  }
  const joined: HeardNote[] = []
  for (const n of line) {
    const last = joined.at(-1)
    if (last && last.midi === n.midi && env && !dipBetween(env, last, n)) {
      last.durS = end(n) - last.startS
      last.amp = Math.max(last.amp, n.amp)
    } else {
      joined.push({ ...n })
    }
  }
  return joined.filter((n) => n.durS >= cfg.minNoteS)
}

/** Note names with lengths, for the fitter: "C4:1 G4:0.5 ...". */
export function notesToText(notes: HeardNote[]): string {
  const tune = snapToBeats(notes.map((n) => ({ bar: n.midi, t: n.startS * 1000 })))
  const beats = [...tune.beats]
  // The last note has no next onset to measure against; a sung note has a length, so use it.
  const last = notes.at(-1)
  if (last && tune.msPerBeat > 0) beats[beats.length - 1] = Math.max(1, Math.round(((last.durS * 1000) / tune.msPerBeat) * 2) / 2)
  return tune.bars.map((midi, i) => `${midiToName(midi)}:${beats[i]}`).join(' ')
}

/** Record from the mic until stopped or the time limit; `onLevel` gets 0..1 for a meter. */
export async function recordVoice(onLevel: (level: number) => void, onLimit: () => void) {
  const chunks: Float32Array[] = []
  let total = 0
  let stopped = false
  const mic = await openMic((s) => {
    if (stopped) return
    chunks.push(s)
    total += s.length
    let sum = 0
    for (let i = 0; i < s.length; i++) sum += s[i] * s[i]
    onLevel(Math.min(1, Math.sqrt(sum / s.length) * 8))
    if (total >= mic.sampleRate * cfg.maxSeconds) onLimit()
  })
  return {
    stop(): { samples: Float32Array<ArrayBuffer>; sampleRate: number } {
      stopped = true
      mic.close()
      const samples = new Float32Array(total)
      let o = 0
      for (const c of chunks) {
        samples.set(c, o)
        o += c.length
      }
      return { samples, sampleRate: mic.sampleRate }
    },
  }
}

/**
 * Basic Pitch in the browser, from the model files served by this app: no
 * audio leaves the tab. It needs 22,050 Hz mono, so the take is resampled first.
 * TensorFlow.js is large, so it loads only when someone sings.
 */
export async function transcribe(samples: Float32Array<ArrayBuffer>, sampleRate: number, onProgress: (pct: number) => void): Promise<HeardNote[]> {
  const rate = cfg.modelSampleRate
  const offline = new OfflineAudioContext(1, Math.ceil((samples.length * rate) / sampleRate), rate)
  const input = offline.createBuffer(1, samples.length, sampleRate)
  input.copyToChannel(samples, 0)
  const src = offline.createBufferSource()
  src.buffer = input
  src.connect(offline.destination)
  src.start()
  const resampled = await offline.startRendering()

  const { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = await import('@spotify/basic-pitch')
  const model = new BasicPitch(cfg.modelUrl)
  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []
  await model.evaluateModel(
    resampled,
    (f, o, c) => {
      frames.push(...f)
      onsets.push(...o)
      contours.push(...c)
    },
    onProgress,
  )
  const events = noteFramesToTime(
    addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, cfg.onsetThresh, cfg.frameThresh, cfg.minNoteFrames)),
  )
  return events.map((e) => ({ midi: e.pitchMidi, startS: e.startTimeSeconds, durS: e.durationSeconds, amp: e.amplitude }))
}
