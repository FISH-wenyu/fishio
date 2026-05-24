# Autostart on Windows (NSSM services)

This doc explains how Fishio survives a reboot — no more `localhost:8080`
"connection refused" after restarting your PC.

We register Fishio as a real Windows service via **NSSM** (the Non-Sucking
Service Manager). NSSM keeps the Node process alive, captures stdout/stderr
into rotating log files, and starts everything automatically at boot —
**before** anyone logs in.

Optional sister services handle `ngrok` and `cloudflared` so your public
tunnel comes back up on its own too.

---

## What gets installed

| Service                | What it runs                                    | Required        |
|------------------------|-------------------------------------------------|-----------------|
| `fishio-server`        | `scripts\start-fishio.cmd` → Node + Express     | always          |
| `fishio-ngrok`         | `scripts\start-ngrok.cmd`  → ngrok http 8080    | only if `USE_NGROK=1`       |
| `fishio-cloudflared`   | `scripts\start-cloudflared.cmd` → quick tunnel  | only if `USE_CLOUDFLARED=1` |

All three start at boot (`SERVICE_AUTO_START`), restart on crash
(`AppExit Default Restart`), and write logs to `state\logs\<name>.{out,err}.log`
with daily / 10 MB rotation handled by NSSM.

---

## One-time install (≈ 5 minutes)

### 1. Prerequisites

Open a **new** PowerShell (i.e. not one inside the Claude desktop app — that
one runs inside a UWP sandbox and installs npm globals into a hidden
per-app prefix). Run:

```powershell
# NSSM — service manager. Required.
winget install --id NSSM.NSSM

# Claude Code CLI — Fishio's brain. Without this, autopilot falls back to
# your local library; the DJ can't talk between songs.
npm install -g @anthropic-ai/claude-code
claude            # then type /login and finish OAuth in your browser

# Optional public tunnels — install only the ones you'll actually use.
winget install --id Ngrok.Ngrok
winget install --id Cloudflare.cloudflared
```

Close that PowerShell and open a fresh one so the new entries in `PATH`
are picked up. Then verify:

```powershell
cd C:\Users\19547\Projects\Fishio
npm run service:verify
```

You should see green `OK` for `node`, `nssm`, `claude.cmd`, `.env`, and
`node_modules`. Red on `claude.cmd` is the most common gotcha — re-open
PowerShell, or check `npm config get prefix` to make sure the global is on
PATH.

### 2. Configure tunnels (optional)

Edit `.env`:

```dotenv
# Turn either on to also auto-start that tunnel as a service.
USE_NGROK=1
USE_CLOUDFLARED=1

# If you reserved a free static ngrok domain at
# https://dashboard.ngrok.com/domains, put it here. Otherwise leave blank
# and ngrok will hand out a new random URL on every restart.
NGROK_DOMAIN=shaking-kissable-breeches.ngrok-free.dev
```

For ngrok, also run once (only the first time on this machine):

```powershell
ngrok config add-authtoken <YOUR_AUTHTOKEN>
```

### 3. Install the services

Open PowerShell **as Administrator** (the installer aborts otherwise):

```powershell
cd C:\Users\19547\Projects\Fishio
npm run service:install
```

The installer is idempotent — re-run it any time after tweaking `.env`,
the wrapper scripts, or the install script itself.

### 4. Reboot to verify

```powershell
shutdown /r /t 0
```

After the reboot, before logging in even, `http://localhost:8080` should
already respond. After login, run:

```powershell
npm run service:verify
```

All three "Services" rows should be `Running`. Liveness rows should be
green.

---

## Day-to-day

```powershell
# Where are we at?
Get-Service fishio-* | Format-Table Name, Status, StartType

# Tail the server log live
Get-Content state\logs\fishio-server.out.log -Tail 50 -Wait

# Restart after editing code or .env
Restart-Service fishio-server

# Stop everything (won't auto-restart until you Start-Service again)
Stop-Service fishio-*

# Get the current public URL ngrok / cloudflared assigned
Get-Content state\logs\fishio-ngrok.out.log        -Tail 20
Get-Content state\logs\fishio-cloudflared.out.log  -Tail 20
```

---

## Uninstall

Run as Administrator:

```powershell
npm run service:uninstall
```

This removes all three services. Your `.env`, `state\state.json`,
`cache\tts\`, and the existing log files are left alone.

---

## Troubleshooting

| Symptom                                                | Likely cause                                              | Fix |
|--------------------------------------------------------|-----------------------------------------------------------|-----|
| `service:install` aborts "must run as Administrator"   | Plain PowerShell                                          | Right-click PowerShell → "Run as Administrator", re-run |
| `nssm.exe not found on PATH`                           | NSSM not installed yet                                    | `winget install --id NSSM.NSSM`, open a new shell |
| `claude.cmd not on PATH` warning                       | Either not installed, or you ran `npm i -g` inside the Claude UWP app's PowerShell | Use the system PowerShell (not Claude's), `npm install -g @anthropic-ai/claude-code` |
| `fishio-server` status = `Stopped` after install       | Crashed on startup — check logs                            | `Get-Content state\logs\fishio-server.err.log -Tail 50` |
| Brain says `Sorry, I missed that. Try again?`          | `claude.cmd` path can't be resolved by the service        | `npm run service:verify`; check the `claude.cmd` row |
| Service runs but `http://localhost:8080` refuses       | Port already taken by something else                       | `Get-NetTCPConnection -LocalPort 8080`; change `PORT=` in `.env`, then `Restart-Service fishio-server` |
| `°C` / `—` / Chinese names look like `��` in logs       | Console code page ≠ UTF-8                                  | The wrapper scripts `chcp 65001` already. View logs in VS Code / Cursor / Notepad++ (Notepad mis-detects UTF-8 without BOM) |
| Ngrok URL changes after every reboot                   | `NGROK_DOMAIN` empty in `.env`                            | Reserve a free static domain at https://dashboard.ngrok.com/domains, set `NGROK_DOMAIN=` and re-run install |
| Cloudflare URL changes after every reboot              | Quick tunnels are stateless by design                      | Upgrade to a named tunnel (see below) |

---

## Optional: stable Cloudflare URL (named tunnel)

The quick tunnel (`cloudflared tunnel --url http://localhost:8080`) is
stateless — a fresh random URL every restart. For a permanent
`https://fishio.yourdomain.com` you'd:

1. Move your domain's DNS to Cloudflare (free).
2. `cloudflared tunnel login` — picks up your zone in the browser.
3. `cloudflared tunnel create fishio` — gives a UUID + credentials file.
4. `cloudflared tunnel route dns fishio fishio.yourdomain.com`.
5. Create `%USERPROFILE%\.cloudflared\config.yml`:

   ```yaml
   tunnel: <UUID-from-step-3>
   credentials-file: C:\Users\<you>\.cloudflared\<UUID>.json
   ingress:
     - hostname: fishio.yourdomain.com
       service: http://localhost:8080
     - service: http_status:404
   ```

6. Replace the body of `scripts\start-cloudflared.cmd` with:

   ```cmd
   cloudflared tunnel run fishio
   ```

7. `npm run service:install` again to pick up the new script.

After that, `fishio.yourdomain.com` resolves to your machine on every
boot, no random URLs.
