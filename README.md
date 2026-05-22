# Fishio

> Your personal AI radio. Claude as the brain, NetEase Cloud Music for songs, ElevenLabs for voice. Runs locally on your machine — a Node.js server + a PWA you can use in the browser or install on your phone.

Fishio reads your taste, picks songs that fit the time of day and the weather, queues them up, plays them back, and talks between tracks like a real DJ. Everything happens on your computer — your taste corpus, your favorites, your blacklist all stay in plain files you can edit.

## Why this exists

Most music apps decide what you hear by what other people listen to. Fishio is the opposite — it makes one DJ for one listener, fed by a small set of plain-text files you control. You write what you like, the brain reads it, and the radio learns to sound like you.

## Features

- 🧠 **Claude as DJ** — picks 1-3 songs per turn, writes a short DJ line, knows your taste / weather / time / what you've already heard / what you've favorited or hidden
- 🎵 **NetEase Music** — searches the catalog, prefers original artist over covers, refreshes stream URLs as they expire
- 🗣️ **ElevenLabs voice** — text-to-speech for the DJ's lines, hash-cached so the same line is only synthesized once
- 🌤️ **Weather aware** — OpenWeatherMap snapshot threaded into every prompt
- ⏰ **Scheduler** — auto-broadcasts at 7am / 9am / hourly during the day
- 🎚️ **Player controls** — play / pause / skip / favorite / hide, queue reorder, click any queue item to jump to it
- 🌗 **Dark / Light theme**, persists to localStorage
- 📱 **Mobile-friendly PWA** — installable on phone (same-WiFi or via Cloudflare Tunnel)
- 🔐 **NetEase VIP** — scan-with-app QR login unlocks paid-catalog tracks

## Architecture

```
                    [Claude Code CLI · subprocess]
                            ↑ prompt = {persona · taste · weather · favs · hidden · history}
                            ↓ JSON  {say · play[] · reason · segue}
[Chat / Schedule] ──► [Router] ─┬─► [NetEase Cloud Music API]  (artist-matched, cover-penalized)
                                ├─► [ElevenLabs TTS]            (hash-cached mp3)
                                └─► [State]                      (queue / current / favs / blacklist / plays)
                                        │ EventEmitter "say" / "tts" / "enqueue" / "advance" / "library"
                                        ▼
                                   [WebSocket /stream]
                                        │
                                        ▼
                                [PWA · localhost:8080]
                                  - Dot-matrix clock + ON AIR
                                  - Player with full controls
                                  - DJ message log (with replay)
                                  - Settings drawer + DJ avatar modal
                                  - Voice input (Chrome / Edge)
                                  - Service worker for "Add to Home Screen"
```

## Requirements

- **Node.js ≥ 20** ([nodejs.org](https://nodejs.org))
- **Claude Code CLI** ([install guide](https://docs.claude.com/en/docs/claude-code/setup)) — requires a Claude account (Max subscription recommended; otherwise the API costs money per token)
- **ElevenLabs account** ([elevenlabs.io](https://elevenlabs.io)) — free tier gives 10k characters/month
- **OpenWeatherMap account** ([openweathermap.org](https://openweathermap.org)) — free tier; key activates ~10 min after creation
- *(Optional)* **NetEase Cloud Music account with VIP** — to unlock paid-catalog streams. Scan-login from the Settings drawer.

## Quick start

```bash
# 1. Get the code
git clone <your-fork-url> fishio
cd fishio

# 2. Install dependencies
npm install

# 3. Install Claude Code CLI (one-time, global) and log in
npm install -g @anthropic-ai/claude-code
claude                 # then type /login and finish OAuth in the browser

# 4. Configure environment
cp .env.example .env
# Edit .env — at minimum set ELEVENLABS_API_KEY. See "Configuration" below.

# 5. Run
npm start
# → http://localhost:8080
```

That's the full vertical slice. The brain works, songs play, the player is live.

## Configuration (`.env`)

Copy `.env.example` to `.env` and fill in:

```dotenv
PORT=8080
CLAUDE_BIN=claude                    # absolute path on Windows: C:\Users\<you>\AppData\Roaming\npm\claude.cmd
CLAUDE_TIMEOUT_MS=60000
SCHEDULER_OFF=0                      # set to 1 to silence the cron schedules during development

# ElevenLabs TTS — required for voice
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=XrExE9yKIg1WjnnlVkGX   # Matilda by default; browse https://elevenlabs.io/app/voice-library
ELEVENLABS_MODEL=eleven_multilingual_v2
ELEVENLABS_STABILITY=0.5
ELEVENLABS_SIMILARITY=0.75
ELEVENLABS_STYLE=0.0

# OpenWeatherMap — optional but recommended
OPENWEATHER_KEY=...
WEATHER_CITY=Seattle                 # or use lat/lon below
WEATHER_LAT=
WEATHER_LON=
```

If you skip ElevenLabs / OpenWeather entirely, Fishio still works — TTS falls back to silent and weather shows as "not configured" to the brain.

## Telling Fishio about your taste

Three plain files under `user/` shape every prompt:

| File | What it's for |
|---|---|
| `user/taste.md` | Free-form prose. Genres you love, artists you anchor on, what you hate, listening moods. |
| `user/routines.md` | Daily rhythm — what suits 7am vs. 11pm vs. work hours. |
| `user/mood-rules.md` | Direct mood→style mappings ("tired → no aggressive drums"). |
| `user/playlists.json` | Bucketed track lists (`favorites`, `morning`, `work`, `night`). Editable by hand or via the Settings drawer's **Import playlist** UI. |

Open these in any editor. Every chat turn re-reads them — no restart needed.

## Using Fishio

### In the browser

- Click anywhere in the input bar, type a line, hit `↑`
- Click any queue row to play that song immediately
- Hover queue rows for ▲ / ▼ / × (reorder / remove)
- Click ♥ to favorite the current track; click `HIDE` to blacklist it
- Click the DJ avatar in any chat bubble → opens a modal with stats + mobile URL
- ⚙ in the top-right opens Settings (NCM login, taste, playlist import, etc.)
- 🎤 in Chrome / Edge starts voice input

### Slash commands (from the input bar)

`/skip`, `/pause` — quick controls. More can be added in `src/router.js`.

### On your phone (same WiFi)

The startup banner prints LAN URLs. Open the WiFi one on your phone's browser, optionally "Add to Home Screen."

### Sharing publicly (any network)

```bash
# Quick (random URL, changes on each restart):
cloudflared tunnel --url http://localhost:8080

# Stable (with ngrok free static domain):
ngrok config add-authtoken <YOUR_TOKEN>
ngrok http 8080 --url=<your-static>.ngrok-free.dev
```

⚠️ **Heads up before exposing publicly:**
- The current architecture is single-tenant — all visitors share one queue and one state file
- Every public chat consumes your Claude / ElevenLabs quota
- If you're logged into NetEase, your account streams the music

For real public deployment you'd need user accounts, per-user state, and a switch from Claude Code CLI subprocess to the Anthropic API (see [docs/setup.md](docs/setup.md#public-deployment) for the migration path).

## Project layout

```
fishio/
├── README.md              this file
├── LICENSE                MIT
├── package.json           dependencies + npm scripts
├── .env                   your secrets (gitignored)
├── .env.example           template — what to put in .env
├── .gitignore
├── prompts/
│   └── dj-persona.md      the DJ system prompt
├── user/                  YOUR taste / routines / playlists (edit freely)
│   ├── taste.md
│   ├── routines.md
│   ├── mood-rules.md
│   └── playlists.json
├── public/                PWA (static assets)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── manifest.json
│   └── sw.js              minimal service worker
├── state/                 persisted runtime state (gitignored)
│   └── state.json
├── cache/                 hash-keyed mp3 cache (gitignored)
│   └── tts/
├── docs/
│   ├── setup.md
│   └── api.md
└── src/
    ├── server.js          Express + WebSocket entry
    ├── router.js          input → brain → ncm → tts → enqueue
    ├── claude.js          Claude Code CLI subprocess adapter
    ├── context.js         6-fragment prompt assembly
    ├── ncm.js             NetEase Music client + QR login
    ├── tts.js             ElevenLabs adapter + cache
    ├── weather.js         OpenWeather snapshot (cached 10 min)
    ├── state.js           JSON-file persistence + library + queue
    ├── stream.js          WebSocket hub
    ├── events.js          in-process EventEmitter
    ├── scheduler.js       node-cron triggers
    └── *.smoke.js         lightweight runnable verification scripts
```

## Smoke tests

Each integration has a tiny script to verify it independently:

```bash
node --env-file=.env src/ncm.smoke.js "陈奕迅 浮夸"   # search → playable URL
node --env-file=.env src/tts.smoke.js "Hello there"   # synthesize one line
node --env-file=.env src/weather.smoke.js             # current weather snapshot
node --env-file=.env src/playlist.smoke.js            # import test playlist
node src/inject.smoke.js "周杰伦 晴天"                # bypass brain, queue a track directly
node src/voice-compare.smoke.js                       # synth same line with 5 voices
```

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) — the unofficial NetEase Music client this project leans on
- [Claude Code](https://docs.claude.com/en/docs/claude-code) — the brain
- [ElevenLabs](https://elevenlabs.io) — the voice
