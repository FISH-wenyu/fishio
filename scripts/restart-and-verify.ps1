# scripts/restart-and-verify.ps1
# Restart fishio-server and run a full health check. MUST be run as Admin.
# Output goes to state\logs\restart-verify.log so callers (incl. agents) can
# read it back even when stdout capture is finicky.

$ErrorActionPreference = "Continue"
$ROOT  = Split-Path -Parent $PSScriptRoot
$LOG   = Join-Path $ROOT "state\logs\restart-verify.log"

if (-not (Test-Path (Split-Path $LOG -Parent))) {
  New-Item -ItemType Directory -Path (Split-Path $LOG -Parent) -Force | Out-Null
}

function W($line) { Add-Content -Path $LOG -Value $line -Encoding utf8 }

"== begin $(Get-Date) ==" | Set-Content -Path $LOG -Encoding utf8

# ── elevation guard ───────────────────────────────────────────────
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  W "FATAL: not running as Administrator. Re-launch from an elevated shell."
  exit 1
}
W "elevated: $($id.Name)"

# ── restart fishio-server ─────────────────────────────────────────
W ""
W "== Restart-Service fishio-server =="
try {
  Restart-Service fishio-server -ErrorAction Stop
  W "  OK"
} catch {
  W ("  FAIL: " + $_.Exception.Message)
}

Start-Sleep -Seconds 4

# ── service status ────────────────────────────────────────────────
W ""
W "== Get-Service =="
Get-Service fishio-server, fishio-ngrok, fishio-cloudflared |
  Format-Table Name, Status, StartType -AutoSize |
  Out-String |
  ForEach-Object { W $_ }

# ── /healthz ──────────────────────────────────────────────────────
W "== GET /healthz =="
try {
  $h = Invoke-WebRequest "http://127.0.0.1:8080/healthz" -UseBasicParsing -TimeoutSec 5
  W ("  " + $h.Content)
} catch {
  W ("  FAIL: " + $_.Exception.Message)
}

# ── /api/meta (should now include brain_primary / brain_fallback / deepseek_configured) ──
W ""
W "== GET /api/meta =="
try {
  $m = Invoke-WebRequest "http://127.0.0.1:8080/api/meta" -UseBasicParsing -TimeoutSec 5
  W ("  " + $m.Content)
} catch {
  W ("  FAIL: " + $_.Exception.Message)
}

# ── /api/chat smoke test ──────────────────────────────────────────
W ""
W "== POST /api/chat (smoke test) =="
try {
  $body = '{"input":"用一句话告诉我此刻济南的天气感受"}'
  $resp = Invoke-RestMethod "http://127.0.0.1:8080/api/chat" `
    -Method POST `
    -ContentType "application/json; charset=utf-8" `
    -Body $body -TimeoutSec 90
  ($resp | ConvertTo-Json -Depth 5) | ForEach-Object { W $_ }
} catch {
  W ("  FAIL: " + $_.Exception.Message)
  if ($_.ErrorDetails) { W ("  BODY: " + $_.ErrorDetails.Message) }
}

# ── server log tails ──────────────────────────────────────────────
W ""
W "== fishio-server.out.log (tail 30) =="
$outLog = Join-Path $ROOT "state\logs\fishio-server.out.log"
if (Test-Path $outLog) { Get-Content $outLog -Tail 30 | ForEach-Object { W ("  " + $_) } }

W ""
W "== fishio-server.err.log (tail 20) =="
$errLog = Join-Path $ROOT "state\logs\fishio-server.err.log"
if (Test-Path $errLog) { Get-Content $errLog -Tail 20 | ForEach-Object { W ("  " + $_) } }

W ""
W "== end $(Get-Date) =="
