# AGENTS.md — instructions for AI coding agents working on Fishio

Read this file first. It captures the hard-won facts about this project
that aren't obvious from the source — the kind of stuff that, if you don't
know, will make you write code that compiles but breaks at runtime.

---

## TL;DR — project at a glance

Personal AI radio that runs locally:
- **Backend**: Node.js (Express + ws) on port 8080 (`src/server.js`)
- **Brain**: Claude Code CLI subprocess (`src/brains/claude.js`) — optionally
  DeepSeek via HTTP (`src/brains/deepseek.js`), selected by `BRAIN_PROVIDER`
- **Music**: NetEase Cloud Music via `NeteaseCloudMusicApi` (`src/ncm.js`)
- **Voice**: ElevenLabs TTS, hash-cached (`src/tts.js`)
- **Persistence**: single JSON file `state/state.json`
- **Frontend**: vanilla JS + WebSocket PWA in `public/`
- **Deploy**: NSSM-managed Windows services (`scripts/install-services.ps1`)

---

## Host environment (matters more than you'd think)

- **OS**: Windows 11, Chinese locale
- **Console code page**: GBK / 936 (NOT UTF-8) — this affects every shell
  interaction. See "Encoding rules" below.
- **PowerShell**: default version is **Windows PowerShell 5.1**, not 7.
  Do NOT use these PS7-only operators: `?.`, `??`, `??=`, `&&`/`||` pipeline
  chaining, ternary `cond ? a : b`. Use full `if`/`else` blocks.
- **Node**: v22.x (installed at `C:\Program Files\nodejs\node.exe`)
- **Claude desktop app is also installed** (UWP MSIX package
  `Claude_pzs8sxrjxfjjc`) — its bundled PowerShell sandbox redirects
  `%APPDATA%` / `%LOCALAPPDATA%` to per-package paths. Anything `npm i -g`
  inside that sandbox is invisible to system PowerShell. We've already
  fallen for this twice (claude-code CLI, ngrok config). When migrating
  state out of the sandbox, candidates live under
  `C:\Users\19547\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\...`.

---

## Encoding rules — non-negotiable

| Surface | Rule | Why |
|---|---|---|
| **`.js` `.json` `.md` `.ps1`** | UTF-8 ok | Node / PowerShell read these as UTF-8 |
| **`.cmd` / `.bat` files** | **100% ASCII** — no em-dash, no Chinese, no Unicode arrows | `cmd.exe` parses .cmd in the system ANSI code page (GBK on this host). UTF-8 bytes are silently mis-decoded and the parser drops lines, breaking even `chcp`. Use `rem` comments, not `::` (`::` interacts badly with `setlocal` blocks). |
| **Wrapper `.cmd` first line** | `chcp 65001 >nul 2>&1` | Switches console **output** code page to UTF-8 so Node logs aren't mojibake. Doesn't affect how cmd reads the file itself. |
| **`server.js` startup** | `process.stdout.setDefaultEncoding("utf8")` already in place | Belt + suspenders for direct `npm start` |

If you ever see `��` or `?` in logs, the cause is one of:
1. A `.cmd` file got Unicode chars (fix the source, save as ASCII)
2. PowerShell host (not Node) decoded Node's UTF-8 stdout as GBK (cosmetic only — the file/UI is fine)

---

## NSSM service architecture

Three services, all `LocalSystem`, all `Automatic` start:

| Service | Wrapper | What it does |
|---|---|---|
| `fishio-server` | `scripts/start-fishio.cmd` | The Node app |
| `fishio-ngrok` | `scripts/start-ngrok.cmd` | Binds `NGROK_DOMAIN` → :8080 |
| `fishio-cloudflared` | `scripts/start-cloudflared.cmd` | Quick tunnel (random URL per restart) |

Critical NSSM facts to remember when editing `install-services.ps1`:

1. **`LocalSystem` PATH is minimal** — it does NOT include winget per-user
   shims. The installer copies `$env:PATH` of the (admin) installing shell
   into `AppEnvironmentExtra "PATH=..."` so the service inherits it.
2. **`LocalSystem` can't read user `AppData`** — and absolutely cannot
   read UWP sandbox `AppData\Local\Packages\<pkg>\...`. Any user-profile
   config (ngrok.yml, claude credentials) must be **copied** to
   `C:\ProgramData\<tool>\` first. The installer does this for
   `ngrok.yml`. If you ever add tools that depend on user-profile config,
   do the same.
3. **Logs**: NSSM writes to `state\logs\<svc>.{out,err}.log` with daily
   rotation + 10 MB cap. Don't add an app-level logger that touches the
   same paths — NSSM owns those files.
4. **`AppExit Default Restart`** — services auto-restart on crash. Keep
   this in mind when debugging: if you see "service restarted N times"
   in event log, the wrapper is failing fast.
5. **Start ordering**: `DependOnService Tcpip` only. Don't add more deps
   without justifying it — NSSM hangs the boot if a dep never reports
   healthy.

To re-apply config changes:

```powershell
npm run service:install   # (Admin) idempotent: stop + remove + recreate
```

---

## Source layout cheat-sheet

```
fishio/
  src/
    server.js          ← HTTP/WS entry, all /api/* routes
    router.js          ← chat dispatch: input → brain → ncm → tts → enqueue
    claude.js          ← thin shim that re-exports from brains/index.js
    brains/
      index.js         ← provider selector + optional fallback
      claude.js        ← spawn Claude Code CLI subprocess
      deepseek.js      ← DeepSeek HTTP (OpenAI-compatible)
    context.js         ← assemble prompt from 6 fragments
    state.js           ← single-file JSON persistence + queue + library
    ncm.js             ← NetEase search/url/lyric + QR login + scoring
    tts.js             ← ElevenLabs adapter + sha256 cache
    stream.js          ← WebSocket /stream hub
    events.js          ← in-process EventEmitter ("say", "tts", "enqueue", ...)
    scheduler.js       ← node-cron triggers (7am, 9am, hourly 10-21)
    autopilot.js       ← refill queue when low (brain → library fallback)
    library.js         ← fill from user playlists when brain offline
    weather.js         ← OpenWeather snapshot, 10-min cached
  public/              ← PWA: index.html, app.js, style.css, sw.js, manifest.json
  prompts/dj-persona.md← the DJ system prompt (single source of voice)
  user/                ← user-editable taste corpus (gitignored on demand)
  state/               ← runtime: state.json, logs/, gitignored
  cache/tts/           ← hash-keyed mp3, gitignored
  scripts/             ← .cmd wrappers + .ps1 service installers
  docs/                ← setup.md, api.md, autostart.md, brain-deepseek.md
```

---

## Code conventions

- **ESM only** (`"type": "module"` in package.json). Never `require()`.
- **No build step.** Vanilla JS for the frontend, plain `.js` for the
  backend. Don't introduce TypeScript / bundlers without asking.
- **No new top-level dependencies without justification.** This project
  has 4 dependencies on purpose (express, ws, NeteaseCloudMusicApi,
  node-cron). Want to add something? Justify it in the PR description.
- **Brain providers must export `ask(prompt)` returning normalized
  `{ say, play[], reason, segue }` and throw `BrainError` on failure.**
  Anything else breaks `router.js`.
- **State writes go through `src/state.js`.** Don't read/write `state.json`
  from anywhere else — concurrency is single-writer in `state.js`.
- **No comments that narrate the obvious.** Comments should explain
  *why* something exists, not *what* it does. Especially: don't comment
  your own diff ("// added retry here"). Use git for that.
- **No emojis in code or docs unless they're already in a UI string.**

---

## Secret management

- `.env` is git-ignored AND has never been committed to history
  (verified via GitHub API on 2026-05-24). Keep it that way.
- The remote `https://github.com/FISH-wenyu/fishio.git` is **public**.
- Don't expose host paths / usernames in HTTP responses. `/api/meta`
  returns `claude_configured: bool`, NOT the actual path.
- ngrok authtoken lives in `C:\ProgramData\ngrok\ngrok.yml` (LocalSystem
  readable). Don't leak it in logs.

---

## Common commands

```powershell
# dev (foreground, hot reload)
npm run dev

# foreground production
npm start

# service management (most cases)
npm run service:install     # (Admin) install/refresh services
npm run service:uninstall   # (Admin) remove services
npm run service:verify      # full health check, exit code reflects status
Restart-Service fishio-server
Get-Content state\logs\fishio-server.out.log -Tail 50 -Wait

# smoke tests for integrations
node --env-file=.env src/ncm.smoke.js "陈奕迅 浮夸"
node --env-file=.env src/tts.smoke.js "Hello"
node --env-file=.env src/weather.smoke.js
```

---

## When you make changes, check

1. Did you touch a `.cmd` file? Open it in a hex view if unsure. Must be
   ASCII.
2. Did you touch a `.ps1` file? Test it on PS 5.1, not PS 7.
3. Did you add a service? It needs `AppEnvironmentExtra PATH=$env:PATH`
   or it'll fail in production.
4. Did you change `src/brains/*` contract? Update the other provider too
   AND `router.js` error handling.
5. Did you change `state.js` schema? Old `state.json` must still load
   (use the `{ ...DEFAULTS, ...JSON.parse(raw) }` pattern that's there).
6. Did you change `prompts/dj-persona.md`? Both Claude and DeepSeek see
   the same prompt — make sure your wording works for both.
7. Did you touch the public API? Update `docs/api.md`.

---

## Known dragons

- **NCM streaming URLs expire ~30 min.** `state.js#currentWithFreshUrl`
  + `state.js#promote` handle refresh; don't bypass them.
- **NeteaseCloudMusicApi throws plain objects, not Error instances.**
  Use `describeNcmError()` in `src/ncm.js` to read them.
- **ElevenLabs free tier only allows starter voices.** If you switch
  voice IDs, check the user's plan first.
- **Cron triggers use host local time.** Watch out when debugging
  scheduled actions — server `Date.now()` ≠ user perception if the
  host clock is wrong.
- **Service workers cache aggressively.** The PWA shell sets
  `Cache-Control: no-store` in `server.js`, but `sw.js` itself could
  trump that if you add caching logic there — don't.
