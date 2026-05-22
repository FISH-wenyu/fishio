# Contributing to Fishio

## Dev setup

```bash
git clone https://github.com/<your-username>/fishio.git
cd fishio
npm install
cp .env.example .env       # fill in your keys
npm run dev                # node --watch, hot-reloads on file change
```

Open http://localhost:8080. See [README](README.md) for what keys you need and where to get them.

## Layout

- `src/` — the Node server (one concern per file: brain, ncm, tts, weather, state, stream, scheduler, events)
- `public/` — the PWA (`index.html` / `style.css` / `app.js`, plus `sw.js` + `manifest.json`)
- `prompts/dj-persona.md` — the DJ system prompt (edit to retune the voice)
- `user/` — corpus the brain reads on every turn
- `docs/` — setup, API reference, this file
- `src/*.smoke.js` — runnable verification scripts, one per integration

## Conventions

- ES modules (`type: "module"` in `package.json`)
- One responsibility per file in `src/`
- Async-first; we use native `fetch` and `node:fs/promises` where possible
- No build step. The browser sees `public/` directly. Keep it that way unless you have a really good reason.
- Comments explain *why* something is the way it is, not *what* the code does.
- New external integrations go in their own module + their own smoke script.

## Branch + PR flow

1. `git switch -c feature/your-change`
2. Code. Add or update a smoke script.
3. Run the smoke for the area you touched.
4. `git commit -m "concise verb-led summary"`
5. `git push -u origin feature/your-change`
6. `gh pr create --fill` (or open via web)
7. Self-review the diff before requesting review.

## Things we'd love help with

- Tests — there's only smoke scripts today. A small test runner (vitest or node:test) would catch regressions cheaply.
- A drag-and-drop polyfill for touch devices — current native HTML5 drag doesn't work on phones.
- Web Audio API mixing so TTS ducks the music instead of pausing it.
- A `docs/architecture.png` rendered from the ASCII diagram.
- Localization of the UI (currently all English strings).

## Things we will probably reject

- Anything that adds a build step (webpack / vite / etc.) without a clear payoff
- Frameworks (React / Vue / etc.) — this is meant to stay vanilla so newcomers can read the source top-to-bottom
- Authentication / multi-user changes — that's a fork-worthy direction; the upstream is intentionally single-tenant
