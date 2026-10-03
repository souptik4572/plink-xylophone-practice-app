# Plink

A patient xylophone practice partner, built for one child and the parent beside her. Hacktoberfest 2026 Weekend Challenge, "Build for a Friend". Full design in [spec.md](spec.md), and the build log, with what broke and the numbers, in [NOTES.md](NOTES.md).

**Try the public demo: <https://plink-tt30.onrender.com>** (see [Public demo on Render](#public-demo-on-render)). Her own copy runs on the family laptop, where by default everything stays local: Gemma runs in Ollama, TabPFN on the laptop itself, and her practice in one SQLite file.

## Run

Requires [uv](https://docs.astral.sh/uv/) (it brings Python 3.12), [pnpm](https://pnpm.io) and [Ollama](https://ollama.com).

```sh
make setup   # .env from .env.example, uv sync, pnpm install, ollama pull
make dev     # backend on 127.0.0.1:8000, app on http://localhost:5173
make test    # pytest and vitest
make eval    # TabPFN drill-picker benchmark
make check   # one Gemma reply and one TabPFN prediction
```

The first time, accept the TabPFN licence (see [below](#tabpfn-licence-one-time)) and make an account in the app (see [Accounts](#accounts)). Open the app at `http://localhost:5173` on the same machine: the microphone needs a secure context, which `localhost` is and a LAN IP is not.

Her name, the family's language and speaking voice, session length, and how much of a challenge the drill picker aims for are set in the app under **Grown-ups → Settings**; `.env` only supplies the first defaults.

## Accounts

A grown-up signs up with an email and a password (8 characters or more), on the laptop and on the demo alike. Everything Plink keeps (her songs and their lessons, practice, settings and calibration) belongs to that account, and no account can see another's.

- Passwords are stored only as Argon2id hashes.
- The avatar at the top right opens the grown-up's **Account** page and **Log out**, both behind the grown-up sum, so she can't log herself out. The page holds your name for the menu, her practice at a glance, where her data and Gemma run, and **Delete account**, which asks for the password and removes the login with everything it owns.
- Logging in returns a 15-minute **access token**: a JWT whose `sub` is the user's id. The app keeps it in memory and sends it as `Authorization: Bearer …`, and every API route reads the user from it.
- A 30-day **refresh token**, also a JWT, sits in an HttpOnly cookie that only `/api/auth` receives. Each refresh swaps it for a new one; logging out revokes it.
- On the laptop the data stays in SQLite (`backend/plink.db`); on Render it is Postgres (`DATABASE_URL`). Tokens are signed with `JWT_SECRET`: Render generates one, and the laptop keeps its own in `backend/.jwt-secret`.
- On a `plink.db` from before accounts, the first account created takes over the practice already in it. A copy of the old file is kept as `plink.db.before-accounts`.

## How she practises

She plays on the on-screen bars (tap or click, or the keys `A S D F J K L ;`), or on her real xylophone through the microphone once a grown-up has calibrated it.

1. **Plink's turn:** Plink plays the part while the bars light up, a little slower than normal.
2. **Her turn:** the next bar glows and Plink waits. There is no buzzer; a miss just makes the right bar wiggle. **Hear it again** (`Space`) replays the part, and **Play back my turn** replays what she played.
3. **Help levels**, picked before each session (and in Grown-ups → Settings):
   - 🌱 *Lots of help*: only the glowing bar plays, and Plink says each colour. Errorless.
   - 🌿 *Some help*: glow and spoken hints when she's stuck.
   - 🌳 *Little help*: she plays from memory, and the glow appears only if she needs it.
4. Every note right first time is a **star**; every 15 stars unlock a **sticker** in her book on Home.
5. After every three parts of her song, Plink slips in a short part on a jump she finds hard. The last part of a session is the one she's most likely to get right ("Last one!").

Plink the mascot shows whose turn it is, and a speech bubble repeats what it says aloud. When a grown-up tries the game out, the "A grown-up is testing" switch keeps that session out of her stars and out of what TabPFN learns.

## Screens

- **Home:** one tap starts her last song, with her star jar, sticker book, streak, TabPFN's pick for today and the last note from Gemma.
- **Play:** a session, as above.
- **Free play:** any song on the bars, with play, pause, loop, step and slower tempos, as a whole or one part at a time.
- **Songs:** her library, with each song's first-try chance from TabPFN, and adding new ones.
- **Grown-ups**, behind a two-digit sum so little hands can't reach settings or "delete all data":
  - *Progress:* sessions, Gemma's notes and her trickiest jumps;
  - *Ask Plink:* questions about her practice, answered by Gemma;
  - *Settings*;
  - *Calibrate* and *Mic check* for her real xylophone;
  - *Data:* "delete all data".

## Where the open models work

- **TabPFN** (Prior Labs), learning from her own practice log from about 20 notes in:
  - chooses the next part at the level she'll get right about 80% of the time;
  - ends every session on the part she's surest of;
  - brings help sooner on the notes it expects her to miss;
  - advises more, less, or "try" a help level, but only for levels it has seen her play;
  - rates every song for her;
  - finds her trickiest jumps, and practice on them comes after every three song parts.
- **Gemma 4** (`gemma4:e4b` through Ollama on the laptop; `gemma-4-26b-a4b-it` on the Gemini API in the public demo):
  - splits songs into named parts;
  - writes praise, the note for you, and what Plink says before each jump practice part;
  - fixes its own answer: when a reply breaks a rule (a lesson skipping a note, a wrong colour), the complaint goes back to it once before the app falls back to fixed text;
  - **reads song cards from a photo**, using its vision;
  - answers **Ask Plink** questions by calling tools over her data and TabPFN.
- **Basic Pitch** (Spotify) turns singing into notes, in the browser.

Detection of her real xylophone is plain signal processing, not a model. A sound only counts as a strike if it rings on after the mallet and only decays, as a few clear partials. Claps, knocks, key clicks and voices are ignored, and the room's noise level is re-measured as she plays. Calibration (Grown-ups → Calibrate) learns each bar from three strikes and checks that each sounds higher than the last; it works across devices whatever their sample rate. The mic is marked beta: so far it has been tested on modelled bar sounds, not yet on her own xylophone.

## Adding songs

Five songs are built in: Hot Cross Buns, Mary Had a Little Lamb, Twinkle Twinkle Little Star, Jingle Bells (chorus) and Happy Birthday. Each is moved to the key that fits her eight bars best, and a note with no bar is marked.

To add one, play it in on the bars, type note letters (such as `C C G:2 C'`), **sing or hum it**, or **photograph a song card**: Gemma counts the notes, then reads each one's number, letter or colour, and the code maps them to her bars and flags any it is unsure of. Singing runs [Basic Pitch](https://github.com/spotify/basic-pitch-ts) in the browser from the model files this app serves, so the recording never leaves the tab. Every new song can be replayed and fixed note by note before it is saved, and Gemma then splits it into named parts.

### TabPFN licence (one time)

TabPFN-3 weights are open-weight under a **non-commercial** licence and need a one-time acceptance before the first download. Run `make check` in a terminal and follow the browser prompt, or accept the **TabPFN-3** licence on the Licenses tab at <https://ux.priorlabs.ai>, copy your API key, and set `TABPFN_TOKEN` in `.env`. Plink pins `TABPFN_MODEL_VERSION=v3`; the library otherwise defaults to v3.5, which has a separate licence.

With `TABPFN_CLOUD=true` in `.env`, the laptop uses Prior Labs' hosted API instead, as the demo does; her practice log then leaves the laptop. The same goes for Gemma with `GEMINI_API_KEY` set. Both are off by default.

## Public demo on Render

Her copy runs on the family laptop. The public demo runs at **<https://plink-tt30.onrender.com>** on [Render](https://render.com), from [render.yaml](render.yaml), with the same open models:

- **`plink`** (web service) serves the built app and the API from one container, on Render's free plan in Frankfurt. It sleeps after 15 minutes without visitors, and the next visit takes about a minute to wake it. Render's HTTPS counts as a secure context, so the microphone works from a phone or tablet too.
- **`plink-db`** (Render Postgres) holds the accounts and each one's practice. It takes no connections from outside Render. It is on the free plan, which Render deletes 30 days after creation.
- **Gemma 4** runs on Google's [Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api), not on Render: `gemma-4-26b-a4b-it` (`GEMINI_MODEL`). With `GEMINI_API_KEY` set, the backend sends Gemma's requests there instead of to Ollama.
- **TabPFN-3** runs on Prior Labs' [hosted API](https://github.com/PriorLabs/tabpfn-client) (`TABPFN_CLOUD=true`), not on Render, so the image carries no PyTorch. If the API can't be reached, Play picks parts in song order instead.
- Each new account starts with **simulated** practice ([eval/seed_demo.py](backend/eval/seed_demo.py)), so TabPFN has a log to learn from on the first visit. Those numbers are invented, not hers.

Audio still never leaves the browser tab. On the demo, what Gemma reads goes to Google's Gemini API: song-card photos, the practice numbers behind a parent note, and Ask Plink questions. The demo's server stores no photo. The practice log TabPFN learns from goes to Prior Labs' API.

To run the demo in your own Render account, use [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/souptik4572/plink-xylophone-practice-app) and paste a `TABPFN_TOKEN` (an API key from [platform.priorlabs.ai](https://platform.priorlabs.ai/account/api-keys)) and a `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey). Render creates the database and `JWT_SECRET` itself.

## Repository layout

- `backend/`: the API, in FastAPI and SQLModel (Python 3.12, uv).
  - `app/`: routes (`main.py`), accounts (`auth.py`), the drill picker and jump practice (`drill.py`, `jumps.py`), the song fitter, and Gemma's jobs (`coach.py`, `ask.py`, `gemini.py`).
  - `eval/`: the benchmark (`make eval`), the model check (`make check`), the simulated child and the demo seeding.
  - `tests/`: pytest.
- `frontend/`: the app, in React, TypeScript and Vite, with plain CSS.
  - `src/screens/`: Home, Play, Free play, Songs, Grown-ups, Account and Login.
  - `src/audio/`: mic capture, strike detection, calibration and the synth.
  - `src/player/`: the on-screen xylophone and the replay engine.
  - `src/kids/`: Plink the mascot, stickers, the grown-up sum and Ask Plink.
  - `src/songs/`: the built-in songs, note letters, singing and playing a tune in.
- `render.yaml` and `Dockerfile`: the public demo.

## Licences and credits

- Plink's code: Apache 2.0 ([LICENSE](LICENSE)).
- [Gemma 4](https://ollama.com/library/gemma4) via Ollama, and via the Gemini API in the demo: Apache 2.0.
- [Basic Pitch](https://github.com/spotify/basic-pitch-ts) by Spotify: Apache 2.0. Model served locally from the npm package.
- [TabPFN](https://github.com/PriorLabs/TabPFN) by Prior Labs: TabPFN-3 weights under a non-commercial licence. The demo reaches it through [tabpfn-client](https://github.com/PriorLabs/tabpfn-client) (Apache 2.0).
- Fonts, self-hosted from npm so the app works offline: [Outfit](https://fonts.google.com/specimen/Outfit), [DM Sans](https://fonts.google.com/specimen/DM+Sans) and [Bungee](https://fonts.google.com/specimen/Bungee), all SIL Open Font License, via [Fontsource](https://fontsource.org).
- Icons: [Lucide](https://lucide.dev) (ISC).
- The built-in xylophone is inspired by my earlier project [souptik4572/xylophone](https://github.com/souptik4572/xylophone). It was rebuilt from scratch here; no code or sound files were copied.
