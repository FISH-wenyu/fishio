# HTTP / WebSocket reference

All endpoints live on the server's port (`PORT` from `.env`, default `8080`). All bodies and responses are JSON. UTF-8 throughout.

## Lifecycle

### `POST /api/chat`
The main entry point. The brain composes a prompt from the listener's corpus + environment + history + this turn, calls Claude, then resolves the resulting song queries via NetEase and synthesizes the DJ line via ElevenLabs in parallel.

```json
// request
{ "input": "i'm working late, give me something calm", "trigger": "user" }

// response
{
  "say":      "Late nights deserve the right company. ...",
  "play":     [
    { "query": "搁浅 - 周杰伦", "id": 66282, "name": "搁浅", "artists": ["周杰伦"], "album": "...", "url": "https://...", "reason": "piano-forward, low energy" },
    { ... }
  ],
  "reason":   "editorial framing",
  "segue":    "optional bridge line",
  "tts_url":  "/tts/<hash>.mp3",
  "took_ms":  29993
}
```

If the brain fails, `say` becomes a polite fallback and `reason` starts with `brain error:`.

### `GET /api/now`
Current playing track, with a fresh stream URL if the cached one is past its NCM validity window.

### `GET /api/next`
Peek at the queue head without advancing. Returns `{ next, queue_length }`.

### `POST /api/advance`
Pop the next item to current. Fired by the client when audio `ended`.

### `POST /api/skip`
Alias for `advance`. Use this when the listener triggers it explicitly.

## Queue manipulation

### `POST /api/queue/jump`
Jump directly to `queue[index]`. Everything before it is skipped.
```json
{ "index": 2 }
```

### `POST /api/queue/move`
Reorder.
```json
{ "from": 1, "to": 3 }
```

### `POST /api/queue/remove`
```json
{ "index": 2 }
```

## Library

### `POST /api/favorite` / `POST /api/unfavorite`
Toggle favorite. Body may contain `{ id, name, artists, query }` to act on a specific track; otherwise acts on the current track.

### `POST /api/hide` / `POST /api/unhide`
Same shape. `/api/hide` also advances past the now-hidden track if it was the current one. The brain sees the blacklist on every turn and the router filters blacklisted IDs as a defensive net.

### `GET /api/library`
```json
{ "favorites": [...], "blacklist": [...] }
```

## Taste / configuration

### `POST /api/taste/playlist`
Bulk import lines into a bucket of `user/playlists.json`.

```json
// either lines: array
{ "bucket": "favorites", "lines": ["稻香 - 周杰伦", "..."] }
// or text: newline-separated string. Lines starting with `#` are comments.
{ "bucket": "morning", "text": "song one\nsong two\n# ignored" }
```

### `GET /api/taste/playlists`
Returns the full `playlists.json`.

### `GET /api/meta`
Read-only config snapshot (voice id, model, city, weather, configured flags).

### `GET /api/me`
What the DJ knows about the listener: voice, weather, top played artists (computed from history), play counts, favorites / hidden counts, LAN URLs.

### `GET /api/network`
LAN URLs with classification (`wifi` / `wired` / `vpn` / `virtual` / `other`).

## NetEase login

### `POST /api/ncm/login/start`
Creates a fresh QR session. Returns `{ key, qrimg }` — `qrimg` is a base64 data URL you can stick in an `<img>` tag.

### `GET /api/ncm/login/check?key=…`
Poll every ~2 s. Returns `{ code, message, saved }` where code is:
- `800` — QR expired
- `801` — waiting for scan
- `802` — scanned, waiting for phone-side confirmation
- `803` — authorized; cookie has been saved to `state.prefs.ncm_cookie`

### `GET /api/ncm/login/status`
```json
{ "loggedIn": true, "nickname": "...", "userId": 123, "vipType": 11, "avatarUrl": "..." }
```

### `POST /api/ncm/logout`
Clears the saved cookie.

## WebSocket — `/stream`

Connect with a plain `WebSocket(`/stream`)`. The server sends a snapshot on connect, then pushes events for the lifetime of the connection.

| `type` | Fired when | Payload |
|---|---|---|
| `snapshot` | On connect | `{ current, queue }` |
| `enqueue` | New tracks added (or queue mutated) | `{ tracks, current, queue }` |
| `advance` | Current track changes | `{ current, queue }` |
| `say` | DJ said a line | `{ text, ts }` |
| `tts` | TTS finished synthesizing | `{ url, text }` |
| `library` | Favorites or blacklist changed | `{ favorites, blacklist }` |

The client uses these to update the UI in real time without polling.

## Static / cache

- `GET /` — PWA shell
- `GET /<asset>` — `app.js`, `style.css`, `manifest.json`, `sw.js`
- `GET /tts/<hash>.mp3` — long-cached synthesized voice files
- `GET /healthz` — `{ ok: true, ts: <epoch_ms> }`
