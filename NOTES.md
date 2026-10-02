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
