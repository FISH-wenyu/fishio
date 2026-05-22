# Setup guide

Step-by-step, from a fresh machine.

## 1. Node.js ≥ 20

Download from [nodejs.org](https://nodejs.org). Verify:

```bash
node --version    # v20.x or higher
npm --version
```

### Windows tip
If `npm` fails with `EPERM`, npm's cache landed inside `C:\Program Files\nodejs\node_cache` (admin-only). Redirect it:

```powershell
npm config set cache "$env:LOCALAPPDATA\npm-cache"
npm config set prefix "$env:APPDATA\npm"
# then add %APPDATA%\npm to your PATH (logout/login or restart shell)
```

If PowerShell blocks running `.ps1` scripts, call the `.cmd` shim directly:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
```

## 2. Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
claude                  # opens the interactive shell
```

In the Claude prompt:

```
/login
```

…and finish the OAuth flow in the browser using an Anthropic account. A Max subscription is what this project assumes; otherwise every call costs money.

Verify:

```bash
claude --version
```

On Windows, find the absolute path with:

```powershell
Get-Command claude.cmd | Select-Object Source
```

…and put that path in `.env` as `CLAUDE_BIN=` (e.g., `C:\Users\<you>\AppData\Roaming\npm\claude.cmd`).

## 3. ElevenLabs API key

- Sign up at [elevenlabs.io](https://elevenlabs.io)
- Open [API Keys](https://elevenlabs.io/app/settings/api-keys)
- **Create API Key** → restrict to **Text to Speech: Access**, name it `fishio`, copy the key (starts with `sk_…`)
- Put it in `.env` as `ELEVENLABS_API_KEY=…`

### Picking a voice

Default voice ID `XrExE9yKIg1WjnnlVkGX` is **Matilda** — knowledgable, professional, decent on Chinese. To swap: browse [voice library](https://elevenlabs.io/app/voice-library), grab a voice id, set `ELEVENLABS_VOICE_ID=` in `.env`.

`src/voice-compare.smoke.js` synthesizes the same line in 5 different voices for comparison.

⚠️ **Free tier voices**: the API only lets free accounts use **starter** premade voices (not the broader library). The script lists what your account can actually call via `GET /v1/voices`.

## 4. OpenWeatherMap key

- Sign up at [openweathermap.org](https://home.openweathermap.org/users/sign_up)
- Confirm your email
- Open [API Keys](https://home.openweathermap.org/api_keys), copy the default key
- ⏳ **New keys take ~10 minutes to activate** — until then you get `401 Invalid API key`. Fishio falls back to "weather not configured" until it activates.
- Put it in `.env` as `OPENWEATHER_KEY=…`
- Also set `WEATHER_CITY=` (e.g. `Seattle`) **or** `WEATHER_LAT=` + `WEATHER_LON=`

## 5. (Optional) NetEase VIP login

By default Fishio uses NCM's unauthenticated catalog. VIP / paid-catalog songs return `url: null` and are skipped. To unlock them:

1. Have a NetEase Music account with 黑胶 / 黑胶 SVIP
2. Open Fishio in your browser → `⚙ Settings → NetEase Music → Scan to login`
3. Open NetEase Cloud Music on your phone → menu → 扫一扫 → scan the QR
4. Tap **confirm** on the phone
5. The cookie is saved to `state/state.json` (`prefs.ncm_cookie`) and used in all subsequent NCM calls

To log out: same panel, **Log out** button.

## 6. Run

```bash
npm start
```

Open http://localhost:8080. The startup banner also prints LAN URLs you can hit from your phone on the same WiFi.

## Public deployment

This section explains how to expose Fishio beyond your LAN.

### Path A — Cloudflare quick tunnel (random URL)

```bash
# Install once
winget install --id Cloudflare.cloudflared   # Windows
brew install cloudflared                     # macOS
# or download from https://github.com/cloudflare/cloudflared/releases

cloudflared tunnel --url http://localhost:8080
# → prints "https://<random>.trycloudflare.com"
```

The URL changes every time you restart cloudflared.

### Path B — ngrok with a free static domain

```bash
# Install
winget install ngrok.ngrok                   # Windows
brew install ngrok                           # macOS

# Configure (one time)
ngrok config add-authtoken <YOUR_TOKEN>      # get from https://dashboard.ngrok.com

# Reserve a static domain at https://dashboard.ngrok.com/domains
# e.g. "yourname-fishio.ngrok-free.app"

# Run
ngrok http 8080 --url=yourname-fishio.ngrok-free.dev
```

Same URL every time. Free tier has bandwidth/connection caps but is plenty for personal use.

### Path C — Cloudflare Tunnel with your own domain

Better for long-term hosting if you already have a domain on Cloudflare DNS.

```bash
cloudflared tunnel login                          # browser auth, picks your zone
cloudflared tunnel create fishio
cloudflared tunnel route dns fishio fishio.yourdomain.com

# Create a config file (~/.cloudflared/config.yml):
# tunnel: <UUID-from-create-command>
# credentials-file: ~/.cloudflared/<UUID>.json
# ingress:
#   - hostname: fishio.yourdomain.com
#     service: http://localhost:8080
#   - service: http_status:404

cloudflared tunnel run fishio
```

### Going truly multi-user

The current code is single-tenant — one shared queue, one shared state file, one shared API quota. To open it to strangers you need:

1. **Replace `src/claude.js`** — Claude Code CLI requires interactive OAuth, which doesn't work on a server. Use the Anthropic API directly with an API key. Cost shifts from your Max subscription to per-token billing (~$0.01-0.03 per chat at current Sonnet pricing).
2. **Add accounts** — Google / GitHub OAuth → user_id on every request
3. **Partition `state.json`** by user_id (or move to SQLite with a `user_id` column)
4. **Rate-limit** per user (e.g. 10 chats per day on the free tier)
5. **Manage costs** — track per-user token usage, paywall heavy users
6. **Privacy** — current code persists chat history; add a privacy policy and a clear-history endpoint

That's a couple of days of work and ongoing cost. Not advisable unless you really want a product.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `claude` not found in new shells | npm global dir not in PATH | Add `%APPDATA%\npm` to user PATH, restart shell |
| Brain says `Not logged in` | Claude Code never finished `/login` | Run `claude` interactively, complete `/login` |
| TTS silently skipped | ElevenLabs 401 / 402 | Check key + free-tier voice. See `src/tts.smoke.js` |
| Weather always "(not configured)" | Key not activated yet | Wait ~10 min after creating |
| Music plays 5s then stops | NCM stream URL expired | Fishio now refreshes URLs on every promotion — restart server if you still see this |
| Public URL works but TTS is silent | ElevenLabs monthly quota hit | Check usage at https://elevenlabs.io/app/usage |
| Audio doesn't auto-play in browser | Browser autoplay policy | Click play once; subsequent advances should auto-resume |
| Chinese characters become `?` | Tool is using non-UTF-8 encoding (e.g. PowerShell 5.1 default) | Use the in-browser UI or a Node smoke script — they handle UTF-8 |
