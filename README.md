# Plink

A patient xylophone practice partner, built for one child and the parent beside her. Hacktoberfest 2026 Weekend Challenge, "Build for a Friend". Full design in [spec.md](spec.md).

## Run

```sh
make setup   # uv sync, pnpm install, ollama pull
make dev     # backend on 127.0.0.1:8000, app on http://localhost:5173
make test
make eval    # TabPFN drill-picker benchmark
```

## How she practises

1. **Plink's turn:** Plink plays the part while the bars light up, a little slower than normal.
2. **Her turn:** the next bar glows and Plink waits. There is no buzzer; a miss just makes the right bar wiggle.
3. **Help levels**, picked before each session (and in Grown-ups → Settings):
   - 🌱 *Lots of help*: only the glowing bar plays, and Plink says each colour. Errorless.
   - 🌿 *Some help*: glow and spoken hints when she's stuck.
   - 🌳 *Little help*: she plays from memory, and the glow appears only if she needs it.
4. Every note right first time is a **star**; every 15 stars unlock a **sticker** in her book on Home.

The Grown-ups area asks for a sum before opening, so little hands can't reach settings or "delete all data".

## Adding songs

Play it in on the bars, type note letters, or **sing or hum it**. Singing runs [Basic Pitch](https://github.com/spotify/basic-pitch-ts) in the browser from the model files this app serves, so the recording never leaves the tab.

Requires `uv`, `pnpm`, and [Ollama](https://ollama.com). Her name, the family's language and speaking voice, session length, and how much of a challenge the drill picker aims for are set in the app under **Grown-ups → Settings**; `.env` only supplies the first defaults. Open the app at `http://localhost:5173` on the same machine: the microphone needs a secure context, which `localhost` is and a LAN IP is not.

### TabPFN licence (one time)

TabPFN-3 weights are open-weight under a **non-commercial** licence and need a one-time acceptance before the first download. Run `make check` in a terminal and follow the browser prompt, or accept the **TabPFN-3** licence on the Licenses tab at <https://ux.priorlabs.ai>, copy your API key, and set `TABPFN_TOKEN` in `.env`. Plink pins `TABPFN_MODEL_VERSION=v3`; the library otherwise defaults to v3.5, which has a separate licence.

## Licences and credits

- Plink's code: Apache 2.0 ([LICENSE](LICENSE)).
- [Gemma 4](https://ollama.com/library/gemma4) via Ollama: Apache 2.0.
- [Basic Pitch](https://github.com/spotify/basic-pitch-ts) by Spotify: Apache 2.0. Model served locally from the npm package.
- [TabPFN](https://github.com/PriorLabs/TabPFN) by Prior Labs: TabPFN-3 weights under a non-commercial licence.
- Fonts, self-hosted from npm so the app works offline: [Outfit](https://fonts.google.com/specimen/Outfit), [DM Sans](https://fonts.google.com/specimen/DM+Sans) and [Bungee](https://fonts.google.com/specimen/Bungee), all SIL Open Font License, via [Fontsource](https://fontsource.org).
- Icons: [Lucide](https://lucide.dev) (ISC).
- The built-in xylophone is inspired by my earlier project [souptik4572/xylophone](https://github.com/souptik4572/xylophone). It was rebuilt from scratch here; no code or sound files were copied.
