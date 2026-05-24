# Switching the brain to DeepSeek (or running both)

Fishio's "brain" is the LLM that picks songs and writes what the DJ says.
Out of the box it uses **Claude Code CLI** (subprocess + OAuth login). You
can replace it — or supplement it — with **DeepSeek** (HTTP API, cheap and
fast) by flipping two lines in `.env`.

Both providers see the exact same prompt assembled by `src/context.js`, so
switching is purely a backend swap — the listener experience stays
identical except for tone/quality differences between the models.

---

## Why DeepSeek?

| | Claude (current default) | DeepSeek V3 |
|---|---|---|
| Cost | Anthropic Max sub ($20+/mo) OR per-token billing | ~¥2 / million input tokens (≈ 1/20 of Claude) |
| Login | Browser OAuth, refresh tokens stored per-user | Just an API key in `.env` |
| Subprocess | Yes (heavyweight spawn per turn) | No (single HTTPS fetch, ~300 ms RTT) |
| Quality (for DJ chat) | Excellent, very natural prose | Very good, slightly more literal |
| Chinese fluency | Excellent | Excellent (native-level) |
| Region | Sometimes slow from CN | Fast from CN (Beijing infra) |

If you're in China, just want lower cost, or want to avoid the OAuth dance
on every machine, DeepSeek is the easy choice. The current setup keeps
**both** available — flip a single env var to switch.

---

## Setup (one time, ~5 minutes)

### 1. Get a DeepSeek API key

1. Visit https://platform.deepseek.com and sign up (phone or email).
2. Top up — `余额充值`. ¥10 is enough for many months of personal use; you
   only get charged for actual usage.
3. Open `API Keys` → `Create new API key`, name it `fishio`, copy the value
   (starts with `sk-...`). You won't see it again, so save it somewhere
   safe.

### 2. Paste the key into `.env`

```dotenv
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

(The other DeepSeek vars already have sensible defaults — don't touch them
unless you know why.)

### 3. Choose your brain mode

In `.env`:

```dotenv
# Option A — Claude primary, DeepSeek as a safety net (the current default)
BRAIN_PROVIDER=claude
BRAIN_FALLBACK=1

# Option B — DeepSeek primary, Claude as fallback (cheaper, faster)
BRAIN_PROVIDER=deepseek
BRAIN_FALLBACK=1

# Option C — DeepSeek only, no Claude at all (you can even uninstall claude.cmd)
BRAIN_PROVIDER=deepseek
BRAIN_FALLBACK=0
```

### 4. Pick a model (DeepSeek side)

```dotenv
DEEPSEEK_MODEL=deepseek-chat       # V3 — recommended for Fishio
# DEEPSEEK_MODEL=deepseek-reasoner # R1 — slower, more expensive, overkill for DJ chat
```

> **Heads-up about R1**: it returns reasoning traces in a separate field
> `reasoning_content` plus the final answer in `content`. Fishio reads
> `content` only, so R1 just works, but each call uses ~5x more tokens.
> Use V3 unless you have a specific reason.

### 5. Reload

```powershell
Restart-Service fishio-server
```

(Tunnels don't need a restart — brain change is server-side only.)

Verify via:

```powershell
npm run service:verify
# look for "GET /api/meta claude_configured" and the new brain fields
```

Or send one chat:

```powershell
Invoke-RestMethod "http://127.0.0.1:8080/api/chat" -Method POST `
  -ContentType "application/json; charset=utf-8" `
  -Body '{"input":"用一句话告诉我现在时间"}'
```

The response `reason` field shows which provider answered when fallback fires:
```
brain error: deepseek 401 invalid auth | fallback claude succeeded
```

---

## How it works (under the hood)

```
router.js
  ├─ buildPrompt()        (context.js — same prompt for both brains)
  └─ ask(prompt)          ← src/claude.js (legacy shim)
                            └─ src/brains/index.js (dispatcher)
                                ├─ pick BRAIN_PROVIDER → providers[that]
                                ├─ on success: return
                                └─ on BrainError + BRAIN_FALLBACK=1:
                                    pick the OTHER provider, retry
                                    if both fail → throw primary error
```

Each provider lives in its own file:

- `src/brains/claude.js` — `spawn("cmd /c claude.cmd -p --output-format json")`
- `src/brains/deepseek.js` — `fetch("POST /chat/completions", { messages: [{ role:"user", content: prompt }], response_format: { type:"json_object" } })`

They both throw a unified `BrainError` from `src/brains/common.js`. The
dispatcher uses that to decide what to log and whether to try a fallback.

---

## Cost watching

DeepSeek bills per token. The `/api/me` endpoint doesn't track this yet —
if you want to know what Fishio is spending, watch your dashboard at
https://platform.deepseek.com → `用量记录`.

Rough math for a typical `say` line + 3-song refill:
- Input: ~3 000 tokens (persona + corpus + history)
- Output: ~400 tokens (one JSON object)
- V3 cost: $0.0008 + $0.0004 ≈ ¥0.009 per turn

At 50 turns/day (heavy use), that's ¥13 / month. R1 is ~5x that.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `brain error: DEEPSEEK_API_KEY not set` | Key missing in `.env` | Paste it, `Restart-Service fishio-server` |
| `brain error: deepseek 401` | Bad key, or you set it in `.env.example` instead of `.env` | Generate a new key, paste into `.env` (not `.env.example`) |
| `brain error: deepseek 402` | Balance ran out | Top up at platform.deepseek.com |
| `brain error: deepseek 429` | Rate limited (rare on personal accounts) | Wait; lower autopilot frequency in `src/autopilot.js` |
| `brain error: model output was not JSON` | Persona prompt got out of sync | Make sure `prompts/dj-persona.md` still says "output strict JSON" |
| Reasoner (R1) replies are empty | R1's final answer can be tiny if `reasoning_content` was the meat | Switch back to `deepseek-chat`; the persona format works there |
| Fallback fires every call (slow) | Primary always 5xx — check your config | `Get-Content state\logs\fishio-server.err.log -Tail 50` |

---

## Going back to Claude only

```dotenv
BRAIN_PROVIDER=claude
BRAIN_FALLBACK=0
```

`Restart-Service fishio-server` — done. The DeepSeek code stays compiled-in
but is never called.
