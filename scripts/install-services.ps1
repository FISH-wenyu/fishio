# install-services.ps1 — One-shot installer that registers Fishio (and
# optionally ngrok / cloudflared) as Windows services via NSSM. Must run in
# an elevated PowerShell. Re-runnable: existing services are removed first
# and recreated, so config changes here always take effect on the next run.
#
# Usage:   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-services.ps1
# Or:      npm run service:install
#
# Pre-flight checklist (the script verifies all of these and aborts on miss):
#   1. Running as Administrator
#   2. nssm.exe is on PATH        →  winget install --id NSSM.NSSM
#   3. node.exe is reachable       →  https://nodejs.org
#   4. claude.cmd is reachable     →  npm install -g @anthropic-ai/claude-code
#   5. .env exists                 →  cp .env.example .env  (then fill keys)
#   6. ngrok.exe / cloudflared.exe — only checked if USE_NGROK=1 / USE_CLOUDFLARED=1

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ServerName  = "fishio-server"
$NgrokName   = "fishio-ngrok"
$CfName      = "fishio-cloudflared"
$LogDir      = Join-Path $ProjectRoot "state\logs"

function Write-Step($msg)  { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[+] $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Die($msg)         { Write-Host "[X] $msg" -ForegroundColor Red; exit 1 }

# ── 1. Elevation ──────────────────────────────────────────────────────────
$me = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($me)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Die "This script must run as Administrator. Right-click PowerShell -> 'Run as Administrator', then re-run."
}
Write-Ok "Running as Administrator."

# ── 2. NSSM ───────────────────────────────────────────────────────────────
$nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source
if (-not $nssm) { Die "nssm.exe not found on PATH. Install with:  winget install --id NSSM.NSSM   (then open a new PowerShell)" }
Write-Ok "nssm found at $nssm"

# ── 3. Node ───────────────────────────────────────────────────────────────
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $nodeExe)) {
    $nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $nodeExe) { Die "node.exe not found. Install Node 20+ from https://nodejs.org" }
}
Write-Ok "node found at $nodeExe"

# ── 4. Claude CLI ─────────────────────────────────────────────────────────
$claudeCmd = (Get-Command claude.cmd -ErrorAction SilentlyContinue).Source
if (-not $claudeCmd) {
    Write-Warn2 "claude.cmd not on PATH — Fishio's brain will be disabled (autopilot will fall back to your local library)."
    Write-Warn2 "To enable the brain: open a NEW PowerShell (not inside the Claude desktop app) and run:"
    Write-Warn2 "    npm install -g @anthropic-ai/claude-code"
    Write-Warn2 "Then re-run this installer."
} else {
    Write-Ok "claude.cmd found at $claudeCmd"
}

# ── 5. .env ───────────────────────────────────────────────────────────────
$envFile = Join-Path $ProjectRoot ".env"
if (-not (Test-Path $envFile)) {
    Die ".env not found at $envFile. Copy .env.example to .env and fill in keys first."
}
Write-Ok ".env present."

# Read tunnel toggles
$useNgrok = $false
$useCf    = $false
$ngrokDomain = ""
foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*USE_NGROK\s*=\s*1')        { $useNgrok = $true }
    if ($line -match '^\s*USE_CLOUDFLARED\s*=\s*1')  { $useCf = $true }
    if ($line -match '^\s*NGROK_DOMAIN\s*=\s*(\S+)') { $ngrokDomain = $Matches[1] }
}

if ($useNgrok) {
    $ngrokExe = (Get-Command ngrok.exe -ErrorAction SilentlyContinue).Source
    if (-not $ngrokExe) { Die "USE_NGROK=1 in .env but ngrok.exe not found. Install:  winget install --id Ngrok.Ngrok" }
    Write-Ok ("ngrok found at $ngrokExe" + ($(if ($ngrokDomain) { ", reserved domain: $ngrokDomain" } else { ", random URL mode" })))
}
if ($useCf) {
    $cfExe = (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source
    if (-not $cfExe) { Die "USE_CLOUDFLARED=1 in .env but cloudflared.exe not found. Install:  winget install --id Cloudflare.cloudflared" }
    Write-Ok "cloudflared found at $cfExe"
}

# ── ngrok.yml — must be readable by LocalSystem ──────────────────────────
# Each NSSM service runs as LocalSystem by default, which cannot read into
# your user profile's UWP-sandboxed AppData. We look in 4 candidate spots
# and copy whichever exists into C:\ProgramData\ngrok\ngrok.yml so the
# wrapper script can pass --config to that stable location.
if ($useNgrok) {
    $candidates = @(
        "$env:LOCALAPPDATA\ngrok\ngrok.yml",
        "$env:APPDATA\ngrok\ngrok.yml",
        "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\ngrok\ngrok.yml",
        "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\ngrok\ngrok.yml"
    )
    $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $found) {
        Die "ngrok.yml not found in any known location. Run 'ngrok config add-authtoken <YOUR_TOKEN>' first, then re-run this installer."
    }
    $programDataYml = "C:\ProgramData\ngrok\ngrok.yml"
    New-Item -ItemType Directory -Force -Path (Split-Path $programDataYml -Parent) | Out-Null
    Copy-Item -Force -Path $found -Destination $programDataYml
    # Grant LocalSystem read access explicitly (inherits by default but be safe).
    $acl = Get-Acl $programDataYml
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "NT AUTHORITY\SYSTEM", "Read", "Allow")
    $acl.SetAccessRule($rule)
    Set-Acl -Path $programDataYml -AclObject $acl
    Write-Ok "ngrok.yml staged for LocalSystem at $programDataYml (source: $found)"
}

# ── Logs dir ──────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Write-Ok "Log dir: $LogDir"

# ── Helper: install one NSSM service from a wrapper .cmd ──────────────────
function Install-NssmService {
    param(
        [string]$Name,
        [string]$WrapperRelPath,
        [string]$DisplayName,
        [string]$Description
    )

    $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Step "Removing existing service '$Name'..."
        if ($existing.Status -ne 'Stopped') { Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue }
        & $nssm remove $Name confirm | Out-Null
        Start-Sleep -Milliseconds 500
    }

    $wrapper = Join-Path $ProjectRoot $WrapperRelPath
    if (-not (Test-Path $wrapper)) { Die "Wrapper script missing: $wrapper" }

    Write-Step "Installing service '$Name'..."
    # NSSM application = cmd.exe, args = /c <wrapper>. This way Ctrl-C, env
    # inheritance, and console redirection all behave the same as if you
    # double-clicked the .cmd file.
    & $nssm install $Name "$env:ComSpec" "/c" "`"$wrapper`"" | Out-Null
    & $nssm set $Name AppDirectory      $ProjectRoot                                    | Out-Null
    & $nssm set $Name DisplayName       $DisplayName                                    | Out-Null
    & $nssm set $Name Description       $Description                                    | Out-Null
    & $nssm set $Name Start             SERVICE_AUTO_START                              | Out-Null
    & $nssm set $Name AppStdout         (Join-Path $LogDir "$Name.out.log")             | Out-Null
    & $nssm set $Name AppStderr         (Join-Path $LogDir "$Name.err.log")             | Out-Null
    & $nssm set $Name AppRotateFiles    1                                               | Out-Null
    & $nssm set $Name AppRotateOnline   1                                               | Out-Null
    & $nssm set $Name AppRotateSeconds  86400                                           | Out-Null   # daily
    & $nssm set $Name AppRotateBytes    10485760                                        | Out-Null   # or every 10 MB
    & $nssm set $Name AppStdoutCreationDisposition 4                                    | Out-Null   # OPEN_ALWAYS / append
    & $nssm set $Name AppStderrCreationDisposition 4                                    | Out-Null
    & $nssm set $Name AppExit Default   Restart                                         | Out-Null   # crash -> auto restart
    & $nssm set $Name AppRestartDelay   3000                                            | Out-Null   # ms

    # Inject the admin shell's full PATH into the service. winget installs
    # ngrok / cloudflared into per-user paths that LocalSystem can't see by
    # default; this hands the service everything we can see right now.
    & $nssm set $Name AppEnvironmentExtra ":PATH=$env:PATH"                             | Out-Null

    # Be polite to NeteaseCloudMusicApi: don't start until network is online.
    & $nssm set $Name DependOnService   Tcpip                                           | Out-Null

    Write-Ok "Service '$Name' installed."
}

# ── 6. Install services ───────────────────────────────────────────────────
Install-NssmService -Name $ServerName -WrapperRelPath "scripts\start-fishio.cmd" `
    -DisplayName "Fishio AI Radio (Node server)" `
    -Description "Fishio personal AI radio - Node server. Auto-starts at boot."

if ($useNgrok) {
    Install-NssmService -Name $NgrokName -WrapperRelPath "scripts\start-ngrok.cmd" `
        -DisplayName "Fishio ngrok tunnel" `
        -Description "Exposes Fishio (localhost:8080) via ngrok. Requires .env NGROK_DOMAIN for a stable URL."
}
if ($useCf) {
    Install-NssmService -Name $CfName -WrapperRelPath "scripts\start-cloudflared.cmd" `
        -DisplayName "Fishio Cloudflare tunnel" `
        -Description "Exposes Fishio via a Cloudflare quick tunnel. URL changes on every restart."
}

# ── 7. Start them ─────────────────────────────────────────────────────────
# Use try/catch per-service so one bad tunnel doesn't block the others.
function Try-Start { param([string]$n)
    Write-Step "Starting $n..."
    try { Start-Service -Name $n -ErrorAction Stop; Write-Ok "$n started" }
    catch {
        Write-Warn2 "$n failed to start: $($_.Exception.Message)"
        Write-Warn2 "Look at state\logs\$n.err.log for the wrapped command's stderr."
    }
}
Try-Start $ServerName
if ($useNgrok) { Try-Start $NgrokName }
if ($useCf)    { Try-Start $CfName    }

Start-Sleep -Seconds 3

# ── 8. Smoke test ─────────────────────────────────────────────────────────
Write-Step "Smoke testing http://127.0.0.1:8080/healthz ..."
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8080/healthz" -UseBasicParsing -TimeoutSec 8
    if ($r.StatusCode -eq 200) { Write-Ok "Fishio is live: $($r.Content)" }
    else                       { Write-Warn2 "Unexpected status $($r.StatusCode). Check $LogDir\$ServerName.err.log" }
} catch {
    Write-Warn2 "Server didn't respond yet. Check logs:"
    Write-Warn2 "  Get-Content '$LogDir\$ServerName.out.log' -Tail 30"
    Write-Warn2 "  Get-Content '$LogDir\$ServerName.err.log' -Tail 30"
}

Write-Host ""
Write-Ok "Install complete. Useful commands:"
Write-Host "  Get-Service fishio-* | Format-Table Name,Status,StartType" -ForegroundColor Gray
Write-Host "  Restart-Service fishio-server"                              -ForegroundColor Gray
Write-Host "  Stop-Service    fishio-*"                                   -ForegroundColor Gray
Write-Host "  Get-Content   '$LogDir\fishio-server.out.log' -Tail 50 -Wait" -ForegroundColor Gray
Write-Host "  npm run service:uninstall   # remove everything"            -ForegroundColor Gray
