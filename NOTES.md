# Build notes

Running log for the post. One entry per milestone: what was built, what broke, numbers worth quoting.

## Decisions confirmed with the friend (Fri 2 Oct)

- Instrument: 8 bars, C major, C to high C (spec default).
- She **reads a little**: short words and note letters are fine on her screens; voice and colour still lead.
- Licence: code is Apache 2.0 (the repo's existing LICENSE), not MIT as first drafted.
- Still open: which laptop it runs on, whether I can be in the room Sunday, consent wording for the post.

## Milestone 0 — scaffold (Fri 2 Oct)

- Built: repo layout per spec section 9; `make setup / dev / test / eval / check`; FastAPI `/api/health`; Vite + React + TS shell proxying `/api` to 127.0.0.1:8000.
- Toolchain: uv 0.12 with Python 3.12.15 (TabPFN 9.1.0 needs >=3.10; the machine only had 3.14, so uv provides 3.12), pnpm 12.8, Ollama 0.35.
- Gemma: `gemma4:e4b` is 6.6 GB, 7.5B parameters at Q4_K_M, the same digest as `gemma4:latest`. First answer took 11.4 s including the cold load.
- Basic Pitch's model (`model.json` + one shard) ships in the npm package; `postinstall` copies it to `public/basic-pitch/` so humming works offline.
- Broke: TabPFN `fit` refused to download weights from a non-interactive shell (`TabPFNLicenseError`). A valid `TABPFN_TOKEN` alone was not enough: the licence also has to be accepted on the account's Licenses tab, and tabpfn 9.1 defaults to TabPFN-3.5, which has a separate licence. Pinned `TABPFN_MODEL_VERSION=v3`. `.env` must be loaded before `import tabpfn`, because tabpfn reads its settings at import time.
- Passed: `make check` gave a Gemma reply in 0.9 s (warm) and a TabPFN-3 prediction on an 80-row table in 33 s on the first run, including the weight download.

## Milestone 1 — built-in xylophone, replay engine, free play (Fri 2 Oct)

- Built: `Xylophone` (8 `<button>` bars, pointer and `A S D F J K L ;`, key caps from `getLayoutMap` where available), a Web Audio synth (sine, 3× partial, 8 ms noise click, 0.5 s decay, a new set of nodes per strike), a `BarStrike` bus, the `PlaybackEngine` (lookahead scheduling on the `AudioContext` clock, highlights read from the same clock each animation frame, pause/resume, tempo 0.5/0.75/1×, loop, step), and the Free play screen with the four built-in tunes.
- Design choice worth quoting: the engine never asks `setTimeout` when a note should sound. A 25 ms timer only tops up a 100 ms window of notes already placed on the audio clock, and the lit bar is whatever that clock says is sounding. So light and sound read the same clock and cannot drift apart.
- Tests: 27 vitest cases (keymap, playback timing with a fake audio clock, notation, built-in tune note counts against the spec table).
- Happy Birthday is in `builtin.json` but does not show on free play yet: it needs the transposing fitter (milestone 3).
- Broke: the first draft created the `AudioContext` on the first animation frame, before any gesture, which browsers block. Fixed with `audioNow()`, which reads the clock without creating the context. Also, a focused song `<select>` swallowed the home-row keys, so it now blurs on change.
- Not yet verified by hand: sound quality, touch glissando on a real tablet, and the "ten fast repeats" lag check.

Milestones 0 and 1 committed in `f095604`. The user said to continue without doing the hands-on milestone 1 checks, so the sound, touch and fast-repeat checks are still open.

## Milestone 2 — calibration, detection, self-test (Fri 2 Oct)

- Built: AudioWorklet mic capture (`public/capture.worklet.js`) with echo cancellation, noise suppression and auto gain all off; a streaming onset detector (10 ms RMS frames, threshold max(4× noise floor, 0.01), 150 ms refractory); a 4096-point Hann-windowed FFT spectrum 20 ms after each onset, 200–6000 Hz, L2-normalised; templates averaged from 3 strikes; a cosine matcher (score ≥ 0.80, margin ≥ 0.05, else "unsure"); self-mute while the app sounds plus a 100 ms tail; Calibrate and Self-test screens with a confusion grid; `GET/PUT /api/instrument` in SQLite.
- Spec deviation: the onset rule also needs the frame to be 1.3× louder than the frame before. Without it, a bar still ringing above threshold after 150 ms triggers a phantom second strike. A decaying tail never rises, while a real re-strike does.
- Calibration guards (not in the spec, cheap): a bar is redone if its three strikes don't agree (each ≥ 0.85 cosine to their mean), or if it sounds like a bar already learned (> 0.92), which catches "hit the wrong bar".
- Synthetic test: bars with inharmonic overtones (2.76×, 5.4×), ±0.3 % detune, varying strength and noise: 40 fresh strikes all match at or above the 36/40 gate, and a C♯ between C and D comes back "unsure". This is not evidence for her real instrument; that is the gate below.
- Broke: Vite inlined the worklet as a `data:` URL in the production build, and `addModule` with a data URL is unreliable. Moved it to `public/`.
- **Gate still open:** a 36/40 self-test on a real xylophone in a real room.

The user chose to defer the milestone 2 gate ("let us focus on the overall implementation, the calibration step can be visited later on"). Calibrate and Mic check moved to a Parent screen.

## Milestone 3 — Play screen, fitter, attempt log (Fri 2 Oct)

- Built: a transposition fitter (`app/fitter.py`), with ties going to the transposition nearest the written key; the songs, sessions and attempts tables; `GET/POST /api/songs`, `POST /api/songs/fit`, `POST /api/sessions`, `POST /api/attempts` (the server derives jump, abs_jump, is_repeat and times_seen_phrase, and takes player from the session so tester rows are marked at the source); `GET /api/next-drill` with the cold-start rule; fallback four-note phrases (3–6 notes, contiguous, cover every note).
- Play screen: song plus input-source picker (the mic is greyed out until calibrated and labelled beta), target tone and glow, wait for the right bar, no buzzer, a spoken colour hint after 3 wrong strikes or 8 s of silence, "Hear it again" (`Space`) that counts replays before her first strike, "Play back my turn" with wrong strikes muted, small and big celebrations, a 5-minute session end with a first-try percentage. Free play became the song library: whole song or one phrase, with Happy Birthday's misfits marked ≈.
- Numbers: Happy Birthday fits 23/25 on eight bars (the two F5s need a B♭ placement), and all four other built-ins fit 25/25. Twinkle gets 10 fallback phrases.
- Broke (caught in review, not in use): a strike in the 450 ms gap between a right note and the next target would have been scored against the next note with a negative response time. Strikes are now ignored until the next target is presented.
- Self-mute now covers the app's spoken hints too, not only its tones.
- Tests: 85 pytest, 48 vitest. The API path was exercised against the live SQLite file and the test rows removed. The Play screen UI itself has not been clicked through in a browser yet.

## Milestone 4 — TabPFN drill picker and benchmark (Fri 2 Oct)

- Built: `app/drill.py` fits `TabPFNClassifier` on all `child` rows (raw DataFrame: `input_source` stays a string and `prev_bar` is NaN at phrase starts; no encoding or scaling), builds each candidate phrase's rows "as if she played it next", averages `predict_proba`, and picks the phrase closest to `DRILL_TARGET` (0.80), never the one just played. Cold start (< 60 rows or one class) walks song order. The Play screen says which picker chose the phrase.
- Off the live loop: each phrase's `POST /api/attempts` schedules a background refresh, cached per session and latest attempt, so `GET /api/next-drill` usually returns a pick computed while she was celebrating. TabPFN warms up in a thread at server start.
- Numbers: TabPFN fit plus predict of 40 candidate rows on a 400-row table takes **4.2 s cold, 0.8 s warm** on this Mac (MPS available). `input_source` as a raw string column works with no encoding.
- Benchmark (`make eval`): leave-one-session-out, predictions pooled across held-out sessions, against majority class, a per-jump miss-rate lookup and logistic regression. **No real sessions yet**, so it says so. The `--synthetic` smoke test (12 simulated sessions, 770 rows, 87 % first-try) gave TabPFN 0.649 vs logistic regression 0.651 ROC AUC, a tie, with both above the jump lookup (0.576). This is a simulated child and must not be quoted as hers.
- Broke: the drill cache was keyed by session id, and SQLite can reuse ids after "delete all data" (and in each test database). Added `clear_cache()`.
- Tests: 93 pytest (including one end-to-end test through real TabPFN, about 3 s), 48 vitest.

## Milestone 5 — Gemma lessons, parent note, praise, play-it-in (Fri 2 Oct)

- Built: `app/coach.py` calls Ollama `/api/chat` with a JSON-schema `format` for three jobs: the lesson builder (`POST /api/songs/{id}/lesson`), the parent note (`POST /api/sessions/{id}/parent-note`, with TabPFN's weakest jumps fed in) and praise lines (`POST /api/praise`). Every call is logged to `backend/logs/gemma.jsonl` with wall-clock time, Ollama's own time and token counts. On invalid output or a timeout, the fallback is fixed four-note phrases, a templated note, or the default praise.
- Frontend: an Add a song screen with "Play it in" (strike gaps snapped to half beats, the median gap taken as one beat) and "Type it" (letters such as `C C G:2 C'`), replay to check by ear, a tappable strip to fix or delete notes, and save, which builds the lesson. Play fetches Gemma praise at session start and writes the parent note when the session ends, including when it ends early. The Parent screen gained Progress (sessions with notes) and Data (two-step "delete all data"). A "grown-up is testing" switch marks a session `tester`.
- **Gemma 4 thinks by default.** With thinking on, Twinkle's lesson took 44 s (975 tokens, including 2.2k characters of thinking); with `think: false` it took 10 s. Thinking is off (`GEMMA_THINK=false`).
- **Timing on this Mac (gemma4:e4b, Q4_K_M, about 22 tokens/s):** a lesson now takes 10–15 s for the built-ins after tips were capped at 12 words (first try: 27–30 s, which hit the 30 s timeout once). A parent note takes about 3–4 s, and 20 praise lines about 10–13 s.
- **Spec deviation:** the lesson job gets its own 60 s timeout (`GEMMA_LESSON_TIMEOUT_S`). It runs once per song and never during play; the parent note and praise keep 30 s.
- **Gemma breaks the 3–6 rule sometimes** (Happy Birthday came back with a 7-note phrase). Code now repairs sizes: it splits long phrases ("Bouncy Bee Buzz 2"), merges short ones into a neighbour, and keeps Gemma's names. Contiguity and full coverage are still enforced strictly, so code still owns the notes. Result: 5/5 built-ins got valid Gemma lessons.
- **Gemma invents names.** With `CHILD_NAME` empty, both the praise lines and the parent note called her "Lily". The prompts now say "never invent a name" and use "your child". They also say not to mention jumps when there is no data for them (tester rows never feed her model).
- Acceptance: a new played-in 18-note tune became a 4-phrase Gemma lesson ("Little Bird Chirp", "Bouncy Ball Hop", …) in 11.9 s. Test rows removed afterwards. The user's own browser sessions (2 and 3, logged as `child` before the tester switch existed) were left alone.
- Tests: 124 pytest, 56 vitest.

## Redesign — Maximalism / Dopamine (Fri 2 Oct)

The user asked for the whole frontend restyled to `DESIGN_PROMPT.xml` (Maximalism / Dopamine), with the UX "super easy to use" and richer features, before milestone 6.

- **One design decision worth writing up:** maximalism (sensory overload, constant motion) fights a game where a small child must find one glowing bar. Everything around the game is loud; during a phrase the page goes into focus. Floating shapes and background words hide, the nav dims, the other bars drop to 55 % opacity, and the target glows in its own colour with a bouncing pointer above it. Her bars keep her instrument's real colours rather than the five design accents, because the spoken hints name those colours.
- **System:** all tokens are CSS variables (`theme/tokens.css`); colour rotation is `tone-0…4` classes (accent, clashing border, two shadow colours, and the ink that reads on the accent); there are pattern, shadow and animation utilities; and the primitives are `Button` (primary, secondary, outline, ghost), `Card`, `Field`, `Switch`, `Chip`, `Deco` (floating shapes and outline background words) and confetti. Still plain CSS, as the spec says, with no Tailwind.
- **Offline:** fonts (Outfit, DM Sans, Bungee) are self-hosted from Fontsource, not Google Fonts, so the no-network rule holds.
- **Information architecture:** Home, Play, Free play, Songs, Grown-ups, with hash routes so refresh and bookmarks work. On phones the nav becomes a bottom tab bar.
  - Home: a one-tap "Let's play!" that starts her last song (spec: "one-click start"), song picks, streak, notes and first-try tiles, the last parent note, and a getting-started checklist.
  - Songs: a library with Practise, Listen and "new Gemma lesson" per song.
  - Grown-ups: Progress (stat tiles plus TabPFN's trickiest jumps as meters), Settings, Calibrate, Mic check, Data.
- **New backend:** `GET/PUT /api/settings`. The spec's parent settings, session length and drill target, were previously `.env` only; name, language, speaking voice, calm mode and key caps join them. `GET /api/progress` returns totals, a day streak and the weakest jumps. Delete-all also clears settings.
- **Celebrations:** confetti, the praise line on screen, and one star per note right first time. A sparkle on each right note.
- **Calm mode** (a Grown-ups switch) and `prefers-reduced-motion` both stop continuous motion, confetti and decorations; colours and borders stay.
- **Verified with headless Chrome** (puppeteer-core driving the local Chrome; screenshots at 1366 and 390 px wide, plus a scripted Play run as a tester). First-pass bugs it caught:
  - the celebration sat below the fold at laptop height, so the stage now shrinks the xylophone when a phrase ends;
  - heading words ran together ("PICKASONG"), so headings got extra word spacing;
  - decorations sat on top of a switch and the hero copy;
  - the hero button overflowed on phones;
  - the song-card colour strips collapsed to zero width;
  - "1 days".
- **Latent bug fixed:** the first note of a session was presented before the xylophone mounted, so its glow could be missed. It is now presented after mount.
- Tests: 132 pytest, 59 vitest.

## Milestone 6 — sing it, and a learning loop built for children (Fri 2 Oct)

The user asked for milestone 6 framed as "making the learning experience more suitable for the children". Built hum-to-notes (spec 7.7 route 2) and reworked the practice loop around how young children learn melodies.

**The learning loop**
- **Call and response.** Before each part, Plink plays it while the bars light (Plink's turn), then hands over (her turn). Spec 7.4 had "Hear it again" but no demonstration; hearing a tune before playing it is how children learn songs. The demo is slower at higher help levels (0.75× / 0.85× / 1×).
- **Help levels (fading prompts)**, chosen per session on the Play setup page and in Settings:
  - *Lots*: errorless. On screen, only the target bar sounds, and its colour is spoken. With the mic, a wrong strike is simply not scored.
  - *Some*: the spec's wait mode.
  - *Little*: from memory. No glow, no target tone, and the pips go white; the glow appears after 3.5 s or after a miss.
- **New TabPFN feature, a spec deviation:** `help_level` is logged on every attempt row and is a TabPFN feature, so the model learns the same jump is easier with more help, and the drill picker asks "how likely at the level she'll play next". An additive migration at startup adds the column to existing databases; the user's 24 existing rows became `some`.
- **Plink the mascot:** an SVG creature with a mallet for a head. Its moods (hello, listen, turn, happy, hint, cheer) show whose turn it is, and a speech bubble mirrors what it says aloud ("Listen…", "Your turn!", "Yellow!", "The red one!", the praise line), for a child who reads a little.
- **Gentle misses:** no buzzer. The target bar wiggles, and Plink glances at it with a hint face.
- **Stars and stickers:** a star for every note right first time (`/api/progress` `stars`, derived from the log, nothing new stored), a sticker every 15 (16 stickers, then the book starts again). The star jar is on Home; a new sticker is revealed and spoken at the end of a session (never for grown-up test sessions). The user's real data: 17 stars, so the kitten is already earned.
- **Grown-ups gate:** a two-digit sum with four big answers before the Grown-ups area. It stays open for the browser tab and can be turned off in Settings.

**Sing it (Basic Pitch)**
- Record up to 20 s with a 3-2-1 countdown, a level meter and a timer. Plink is in "listening" mode.
- **Spec correction:** spec section 5 says Basic Pitch "resamples to 22,050 Hz mono itself". It does not: it throws unless the input is already 22,050 Hz mono, so Plink resamples with an `OfflineAudioContext`.
- TensorFlow.js and Basic Pitch load only when someone sings (a 1.0 MB lazy chunk); the main bundle is 336 kB. The model is served from `public/basic-pitch/`.
- Then: clean, then transposing fitter, then beats snapped to half beats (the last note keeps its sung length), then the editable strip (now also with "add a note") and replay.
- **Cleaning, in two spec deviations backed by measurement:**
  1. Basic Pitch runs each note up to the next onset, so a sung "C C" arrives *touching* (gap ~10 ms). The spec's "merge immediate repeats" (and my first 50 ms-gap rule) turned Twinkle's 14 notes into 8 — 6 fixes, failing the gate.
  2. A held note with vibrato comes back as many same-pitch fragments: a low voice gave 7 pieces for one F♯ F♯ pair, and 26 notes for a 14-note tune.

  The fix uses the take's loudness envelope. Same-pitch neighbours are joined only if the voice did *not* dip between them (a real repeat is re-attacked). Notes more than 14 semitones from the median pitch, or under half the typical loudness, are dropped (a rumble at MIDI 35 in the low take). The 120 ms minimum is applied after joining, so fragments aren't lost.
- **Gate (spec: a hummed Twinkle fitted with at most 3 fixes).** Synthetic voice-like hums of Twinkle lines 1–2 went through the real UI: Chrome's fake microphone fed a WAV through `getUserMedia`, then capture, resampling, Basic Pitch, cleaning, fit and strip. Fixes are the edit distance to the true bars.

  | Take | Before the fix | After |
  | --- | --- | --- |
  | Clean hum in D, 100 bpm, ±12 cents | 6 | **0** (fitter moved it 2 steps down) |
  | Low voice in A, 80 bpm, heavy vibrato, legato, ±25 cents | 26 notes of junk | **0** |
  | Child-like voice in G, 120 bpm, ±30 cents, breathy | ~4 | **1** (one detuned note, flagged as a misfit) |

  Transcribe plus fit takes 1.3 s on this Mac. These are synthetic voices; a real hummed take from the family is still to do.
- Harness gotchas worth remembering: Chrome's fake-audio-from-file is silent unless `--disable-features=AudioServiceSandbox` is set; and zsh doesn't word-split `$var`, which silently fed Chrome a nonexistent file name in looped runs.

**Bugs found by driving it in headless Chrome**
- The stage kept the setup page's scroll position, so Plink and the title slid under the sticky nav. Each part now starts scrolled to the top.
- The user's saved calibration predates colour names, so hints said "E!" and "Try the E one". Instruments using the standard colours now get their names back (`withColourNames`).
- Icon-and-sentence lines wrapped the sentence under the icon; added a `.with-icon` utility.

Tests: 138 pytest, 85 vitest. **Not committed:** the user asked to review the changes first.

## AI upgrades for the Gemma and TabPFN prize categories (Fri 2 Oct)

Judging (challenge 78, `full_details`): partner categories ask whether the project "use[s] that technology in a meaningful way"; the prompt asks that "the open pieces should be what makes your project work". Before this, TabPFN was dormant in a demo (36 rows < 60), and Gemma only wrote text even though the local model lists vision, audio, tools and thinking. The user chose: all four TabPFN items, plus Gemma song-from-photo and Ask Plink, with English only.

**TabPFN now makes five decisions**
1. **Learns from session one.** Spec deviation: 60 rows became 20 rows, with at least 3 hits and 3 misses (TabPFN is built for tiny tables). Live: it picked Twinkle part 4 at 79% (target 80%), learning from 36 notes, fit and predict in about 1 s.
2. **Per-note help.** A pick now returns TabPFN's prediction for every note of the chosen part, at no extra model calls. Below 0.6 the glow comes 65% sooner (little help), the colour is spoken, and the hint comes at 4 s instead of 8 s; at 0.88 or above, help holds back (hint at 11 s). Tricky notes get a spark under their pip. Each attempt row now logs `predicted_success` (not a feature), and `make eval` prints live calibration once 10+ notes have predictions.
3. **Help coach.** One fit predicts every song at every help level. Advice is "less" / "more" / "stay" / "**try**". Caught before shipping: all 36 rows were at "some", so all three levels predicted identically; the model can't know what it hasn't seen, and the naive rule would have said "ready for less help" with no evidence. TabPFN now only judges a level with 8+ rows there; otherwise it suggests trying that level once ("try").
4. **Song difficulty for her.** A first-try % on each Songs card, and "TabPFN's pick today" on Home (the song closest to her sweet spot).
5. **Trickiest jumps** now come from TabPFN at 20+ rows (live: C→D 17%, C→G 30%, C→F 32%).

**Real benchmark.** First run on `plink.db`: 3 sessions, 36 rows, **all played by the user while testing, not by her yet**.

| Model | Accuracy | ROC AUC | Log loss |
| --- | --- | --- | --- |
| Logistic regression | 0.778 | 0.819 | 0.442 |
| TabPFN | 0.778 | 0.858 | 0.419 |

Far too little data to claim a win. The benchmark also exposed a milestone 6 bug: the new `help_level` text column crashed the logistic baseline (fixed, with a test).

**Gemma 4 vision: a song from a photo**
- Probed on three generated Twinkle cards (letters, numbers, colour only) before building:

  | Approach | Letters | Numbers | Colours | Time |
  | --- | --- | --- | --- | --- |
  | Flat list, no thinking | 8/14 (stopped early) | 14/14 | made up "1 2 3 4…" | 6–12 s |
  | Row by row, no thinking | 12/14 | 12/14 | 12/14 (no more invented numbers) | 7–8 s |
  | Row by row, thinking | 14/14 | 12/14 | 14/14 | 28–47 s |
  | **Two passes: count (thinking), then list (no thinking)** | **14/14** | **14/14** | **14/14** | **~25 s** |

  The small model's weak spot is counting, so it counts first, carefully, then lists fast with the counts given. Thinking stays off for every text job, where it only cost time, and is on only for the counting step.
- Code owns the notes: the printed number or letter wins, colour tells low C from high C, and a note whose symbol and colour disagree is flagged dashed. On the letters card it flagged a turquoise "G" Gemma had called "green", and the bar was still right.
- Through the real UI (file upload): the title and all 14 notes were read exactly. The photo is shrunk in the browser to 1280 px, sent only to the local server, and never stored. Not yet tried on a photographed real card.

**Gemma 4 tools: Ask Plink**
- Ollama function calling with five read-only tools: `get_progress`, `list_songs`, `predict_song` (TabPFN), `help_advice` (TabPFN), `recent_sessions`. At most 4 rounds; levels not yet tried are sent as null and the prompt makes Gemma say so; answers come in the family language; it only talks about her practice. Each answer shows which tools it used.
- Live: "Is she ready for Jingle Bells?" called `predict_song`, cited 87%, and passed on TabPFN's "try little help". "Should she have less help?" said stay. "Capital of France?" was refused. 2.5–9 s.
- Failure found and fixed: asked "what next?", Gemma misread the song list (it called the 85% song the easiest when another was 87%). Songs are now **ranked in code**, with TabPFN's suggested next song named, so Gemma only explains. TabPFN decides, Gemma explains.

**Two bugs found by running it for real**
- **Server deadlock (PyTorch on the GPU).** The backend stopped answering. `sample` on the worker showed three request threads stuck in `MetalShaderLibrary::exec_unary_kernel`: concurrent first use of an MPS kernel, triggered by the TabPFN warm-up thread plus Ask Plink requests. This can also happen in normal use (background drill refresh, insights, warm-up). Every TabPFN fit and predict now runs under one process-wide lock, with a test that fails without it (6 threads inside at once, now 1). The deadlocked worker was force-stopped and auto-reloaded.
- **React crash in Ask Plink.** "destroy is not a function": Chrome's `scrollIntoView` now returns a Promise, and an arrow-bodied `useEffect` handed it to React as a cleanup. Fixed with a block body.

Tests: 169 pytest, 91 vitest; typecheck and build clean. **Not committed:** the user asked to review first. The user's sessions (1–3, 5–7) were untouched; scripted runs were all tester sessions and were removed.

## Public demo on Render (Fri 2 Oct)

Entering **Best Use of Render**, a featured category in challenge 78; judges ask whether a project uses it "in a meaningful way". The user chose: Render hosts only the public demo, and her copy stays on the laptop.

- Built: a `render.yaml` Blueprint.
  - `plink` (web service, `2c-4g`, 1 GB disk) serves the built app and the API from one container.
  - `plink-gemma` (private service, `4c-16g`, 15 GB disk) runs Ollama with no public address; only `plink` reaches it, over Render's private network.
  - An environment group holds `GEMMA_MODEL` for both services.
- The `Dockerfile` builds the app with pnpm, then the API with uv. On Linux, torch now comes from PyTorch's CPU index: 18 CUDA packages and triton left the lockfile, and the Mac's install is unchanged.
- `eval/seed_demo.py` fills an empty database with 6 simulated sessions (373 attempts), so TabPFN is live on the first visit. Only the start command in `render.yaml` runs it, so a copy started any other way never gets invented rows. `OLLAMA_URL` now also accepts Render's bare `host:port`.
- Spec exceptions, for the Render demo only: cloud hosting (a section 4 non-goal), binding to `0.0.0.0` (section 6), and network calls beyond `localhost` (directive 14.6). `make dev` is unchanged.
- Render has no GPUs. On this Mac, CPU only with 4 threads, `gemma4:e4b` wrote 12.4 tok/s. Gemma's timeouts are raised only on Render (180 / 300 / 900 s).
- Broke: **threads against the CPU limit.** In a container limited to 1 CPU, torch saw all 10 CPUs and started 10 threads. The kernel throttled it for 486 s, and picks took 23–38 s; the first took 282 s, including the weight download. Setting `OMP_NUM_THREADS` to the plan's CPUs fixed it, with 0 s throttled. Ollama did the same (`n_threads = 10` under a 4-CPU limit) and has no server setting for it, so the Gemma image re-creates the model with `PARAMETER num_thread`. Vision, tools and thinking survive that, and a small test model went from 421 to 626 tok/s.
- Broke: the uv download cache was left in the image (1.1 GB). `UV_NO_CACHE=1` took the image from 3.47 to 2.06 GB.
- TabPFN in Docker on this Mac (linux/arm64), on the 373-row demo log, with threads matched:

  | Limits | Next drill | Progress | Insights | Peak memory |
  | --- | --- | --- | --- | --- |
  | 1 CPU, 2 GB | 6.4 s | 5.1 s | 9.3 s | 2048 MB (at the limit) |
  | 2 CPUs, 4 GB | 3.4 s | 2.7 s | 4.9 s | 1727 MB |

  So the web service is `2c-4g`. Its first pick was 80% expected success (target 80%), learning from all 373 rows.
- Privacy on the demo: audio still never leaves the tab; a song-card photo goes to the demo's server to be read, and is not stored.
- Not done yet: the first deploy from the user's Render account, and Gemma's real speed on Render's CPUs. Gemma e4b could not be run in Docker here: the Docker VM has 8 GB.

Tests: 170 pytest, 91 vitest.

## Accounts and login (Sat 3 Oct)

The user asked for authentication and authorization with email and password only: SQLite on the laptop as before, and Render's Postgres for the hosted copy. Mid-build they added: "JWT token with userId in it - an access token and a refresh token mechanism". Spec section 4 listed accounts and multi-user support as non-goals; this is at the user's request. Their choices: the laptop logs in too, each new demo account gets simulated practice, and Render's free Postgres plan.

- Built:
  - `users` and `refreshtoken` tables. Every other row (songs, sessions, attempts, settings, calibration) carries a `user_id`. Each user gets their own copy of the built-in songs, so a Gemma lesson, and the lyric typed for it, never reaches another family.
  - Passwords are hashed with Argon2id. The access token is a 15-minute HS256 JWT whose `sub` is the user id. It is sent as a Bearer header, held only in the page's memory, and checked without touching the database. The refresh token is a 30-day JWT in an HttpOnly, SameSite=Strict cookie that only `/api/auth` receives. Its `jti` is stored, so each refresh rotates it and logout revokes it.
  - Every `/api` route except health and the four auth routes reads the user from the token and touches only that user's rows. Another user's session or song id gets a 404. Ask Plink's tools take the user from the server; a Gemma tool argument naming another user is rejected. TabPFN's caches are keyed per user.
  - `DATABASE_URL` switches to Postgres through psycopg 3; when unset, the database is `backend/plink.db`. `render.yaml` adds `plink-db` (free plan, no connections from outside Render), a generated `JWT_SECRET`, and `DEMO_SEED`. That seeds each new account at sign-up, replacing the old seed-the-database step at start.
  - App: a login and sign-up screen in the house style, Log out under Grown-ups → Data, and a silent refresh-and-retry when an access token runs out.
  - Migration: on a `plink.db` from before accounts, the file is copied to `plink.db.before-accounts`. `song` is rebuilt because its primary key gains `user_id`, and every row without an owner goes to one user with no email. The first sign-up claims that user.
- Broke: **the migration ran on the user's real `plink.db` mid-build.** `make dev` was running with `--reload`, so each save of `models.py` restarted the server and ran `init_db`. It ran twice, once per draft, and the second run overwrote the first backup. Every row survived; I checked each original column against the backup: 36 attempts, 6 sessions, 5 songs with their lessons, settings and calibration. The draft left behind an unused `account` table, an empty `loginsession` table, and `account_id` columns.
- Broke: two tabs refreshing with the same cookie would log one of them out once rotation existed. A rotated token now stays good for 30 s, and its row is locked during the refresh. 8 concurrent refreshes on Postgres: all 200, one new cookie, no fork.
- Not needed after all: a `timezone=utc` connection option for Postgres. SQLModel 0.0.47 stores and returns datetimes as UTC (`UTCDateTime`); a negative control against a server set to UTC+14 showed it, so the option was removed.
- Numbers (this Mac, Postgres 17 in Docker): sign-up with demo seeding (373 rows) took about 240 ms. That account's first TabPFN pick took 0.8 s (Twinkle part 4 at 82%, target 80%), and insights took 1.0 s.
- Verified:
  - All 188 pytest on SQLite, then again on Postgres 17 (`TEST_DATABASE_URL`), including against a server set to UTC+14.
  - Mutating three authorization filters failed their tests each time.
  - Headless Chrome on Postgres, 17 checks: login screen, sign-up, staying logged in across a reload, no token in web storage, the HttpOnly cookie, logout, wrong password, a second family's isolation, a duplicate email, and a 390 px phone.
- Not done:
  - No rate limit on login attempts.
  - No password reset, which would need email.
  - An access token stays valid for up to 15 minutes after logout (the refresh token is revoked at once).
  - The first real deploy with Postgres.

Tests: 188 pytest, 96 vitest. **Not committed.**

## Gemma on the Gemini API for the demo (Sat 3 Oct)

The user decided Render won't host a Gemma model: "we will simply use the gemini API for the same with gemma model". `render.yaml` loses the `plink-gemma` private service (`4c-16g`, 15 GB disk), its Ollama image (`deploy/ollama/`), the shared `gemma-model` group and the CPU-sized timeouts. It gains `GEMINI_API_KEY` (asked for at Blueprint creation) and `GEMINI_MODEL`. The laptop keeps Ollama.

- Built: one adapter (`app/gemini.py`) at the seam every Gemma call already passes through (`coach._post`). The coach and Ask Plink still speak Ollama's chat format. With `GEMINI_API_KEY` set, the adapter turns a request into `generateContent` and the reply back:
  - system prompt → `systemInstruction`; JSON schema → `responseJsonSchema`; `think` → `thinkingLevel` "high" or "minimal"; images → `inlineData`;
  - tools → `functionDeclarations`, and answers → `functionResponse` parts with the call's id.
  - The model's own parts go back unchanged on the next turn. Gemma 4 on the API attaches a `thoughtSignature` to each function call, even with thinking at "minimal".
- The two Gemma 4 models the API serves (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`), every job, live:

  | | 26B-A4B (mixture of experts) | 31B (dense) |
  | --- | --- | --- |
  | Lessons valid (5 built-ins × 2) | 7/10, median 6.5 s | 7/10, median 55 s |
  | Song card, 14 notes | 14/14 in 9.7 s | 14/14 in 86 s |
  | Ask Plink tool call | right tool, 5.0 s | right tool, 49 s |

  The demo uses 26B-A4B. Through the real endpoints on a seeded account: Ask Plink 5.9 s, lesson 6.4 s, parent note 3.7 s, praise 4.2 s.
- Broke:
  - The JSON schema is followed loosely. 2 of 8 lesson replies were valid JSON followed by a stray "```", so the adapter keeps only the first JSON object.
  - Some lessons still overlap or skip notes, and the validator sends those to the fixed phrases. On the laptop's e4b, all 5 built-ins got valid lessons.
  - Thinking made lessons worse: 1 of 10 valid at "high". Lessons stay at "minimal"; only the card count thinks.
  - The API answered 500 "Internal error" or 503 "high demand" on 4 of 10 lesson calls to 31B, so the adapter tries those twice more, 1 s and 3 s later. A 429 quota is not retried.
  - Single calls sometimes took over 30 s (one praise and some lessons timed out), and the callers fall back as before.
  - With no thinking setting, Gemma thinks: a six-word hello took 30 s, and 1.4 s with "minimal". Every app call sets it.
- Health no longer calls Ollama when the key is set, so Render's frequent probes cost no API calls. The field is renamed `gemma`, since it isn't always Ollama.
- Tests run with the key blanked, so they never reach Google, even with a key in `.env`.
- Privacy on the demo: song-card photos, the practice numbers behind a parent note, and Ask Plink questions now go to Google. A laptop without `GEMINI_API_KEY` sends nothing.

Tests: 198 pytest, 96 vitest. **Not committed.**

## Account menu and page (Sat 3 Oct)

The user asked for a logged-in user dashboard, logout, and profile options. Their choices: an avatar menu in the top bar whose Account and Log out links both pass the grown-up sum; profile options limited to a display name and Delete account; on the page, her practice at a glance and the account's details.

- Built:
  - The avatar shows the initial of the grown-up's name, or of their email, and opens a small menu (who's logged in, Account, Log out). It closes on Escape or an outside click; on phones it keeps the top bar's right corner while the nav sits at the bottom.
  - Log out asks to confirm, because afterwards she can't play until a grown-up logs back in. Logging back in lands on Home.
  - The page (`#/account`) holds: your name (`users.display_name`, added to existing databases at start); her stars, streak, sessions and notes, the latest note from Gemma, and shortcuts to Progress, Settings and Songs; email, member since, where her data is kept (SQLite on the laptop or Render Postgres) and where Gemma runs.
  - Delete account removes the login and everything it owns. It asks for the password again; a wrong one answers 403, not 401, because the app takes a 401 for an expired login and would refresh or log out.
  - The "Your login" card from the Data tab is gone; the menu replaces it.
- Broke: the practice card said "No practice yet" while `/api/progress` was still loading (a TabPFN fit, a second or more on a seeded account). It shows "Loading…" until the numbers arrive.
- Verified: headless Chrome against a separate server, 29 checks, twice. They cover the menu (Escape, outside click, focus), the sum before both pages (in a fresh tab too), saving the name and keeping it across a reload, the logout confirmation, a wrong and a right password for deletion, the deleted login failing, and the menu and page at 390 px.

Tests: 205 pytest, 97 vitest. **Not committed.**
