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
