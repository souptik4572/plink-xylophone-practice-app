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
