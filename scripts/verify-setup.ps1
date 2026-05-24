# verify-setup.ps1 — non-destructive health check. Run this any time you
# wonder "is Fishio actually working?" — it prints a colored report and
# never modifies anything.
#
# Usage:   npm run service:verify
# Or:      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-setup.ps1

$ErrorActionPreference = "Continue"

function Check { param([string]$Label, [scriptblock]$Test)
    Write-Host -NoNewline ("  {0,-44} " -f $Label)
    try {
        $r = & $Test
        if ($r -is [bool]) { $r = if ($r) { @{ ok=$true } } else { @{ ok=$false; msg="false" } } }
        if ($r.ok) {
            Write-Host -NoNewline "OK"      -ForegroundColor Green
            if ($r.msg) { Write-Host " — $($r.msg)" -ForegroundColor DarkGray } else { Write-Host "" }
        } else {
            Write-Host -NoNewline "FAIL"    -ForegroundColor Red
            if ($r.msg) { Write-Host " — $($r.msg)" -ForegroundColor Yellow } else { Write-Host "" }
        }
    } catch {
        Write-Host "ERROR — $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "Fishio setup verification" -ForegroundColor White
Write-Host "==========================" -ForegroundColor DarkGray

# Environment
Check "node 20+ installed" {
    $v = (& node -v 2>$null)
    if (-not $v) { @{ ok=$false; msg="node not on PATH" } }
    elseif ($v -match "v(\d+)\.") {
        $maj = [int]$Matches[1]
        if ($maj -ge 20) { @{ ok=$true; msg=$v } } else { @{ ok=$false; msg="$v (need >=20)" } }
    } else { @{ ok=$false; msg=$v } }
}
Check "nssm.exe on PATH" {
    $p = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source
    if ($p) { @{ ok=$true; msg=$p } } else { @{ ok=$false; msg="winget install --id NSSM.NSSM" } }
}
Check "claude.cmd on PATH (brain)" {
    $p = (Get-Command claude.cmd -ErrorAction SilentlyContinue).Source
    if ($p) { @{ ok=$true; msg=$p } } else { @{ ok=$false; msg="npm install -g @anthropic-ai/claude-code  (brain disabled until fixed)" } }
}
Check "ngrok.exe on PATH (optional)" {
    $p = (Get-Command ngrok.exe -ErrorAction SilentlyContinue).Source
    if ($p) { @{ ok=$true; msg=$p } } else { @{ ok=$true; msg="not installed (only needed for public tunnel)" } }
}
Check "cloudflared.exe on PATH (optional)" {
    $p = (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source
    if ($p) { @{ ok=$true; msg=$p } } else { @{ ok=$true; msg="not installed" } }
}

# Project files
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Check ".env exists" {
    $f = Join-Path $ProjectRoot ".env"
    if (Test-Path $f) { @{ ok=$true } } else { @{ ok=$false; msg="cp .env.example .env" } }
}
Check ".env tracked by git? (should be NO)" {
    Push-Location $ProjectRoot
    $tracked = git ls-files .env 2>$null
    Pop-Location
    if ($tracked) { @{ ok=$false; msg="DANGER: .env is committed — rotate secrets immediately" } } else { @{ ok=$true } }
}
Check "node_modules installed" {
    $f = Join-Path $ProjectRoot "node_modules\express"
    if (Test-Path $f) { @{ ok=$true } } else { @{ ok=$false; msg="run: npm install" } }
}

# Services
Write-Host ""
Write-Host "Services" -ForegroundColor White
Write-Host "--------" -ForegroundColor DarkGray
$expected = @("fishio-server", "fishio-ngrok", "fishio-cloudflared")
foreach ($n in $expected) {
    Check "service: $n" {
        $s = Get-Service -Name $n -ErrorAction SilentlyContinue
        if (-not $s) { @{ ok=$false; msg="not installed (npm run service:install)" } }
        elseif ($s.Status -eq 'Running') { @{ ok=$true; msg="Running, StartType=$($s.StartType)" } }
        else                              { @{ ok=$false; msg="Status=$($s.Status), StartType=$($s.StartType)" } }
    }
}

# Liveness
Write-Host ""
Write-Host "Liveness" -ForegroundColor White
Write-Host "--------" -ForegroundColor DarkGray
Check "port 8080 listening" {
    $c = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    if ($c) { @{ ok=$true; msg="PID=$($c[0].OwningProcess)" } } else { @{ ok=$false; msg="no listener" } }
}
Check "GET /healthz" {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8080/healthz" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { @{ ok=$true; msg=$r.Content } } else { @{ ok=$false; msg="HTTP $($r.StatusCode)" } }
    } catch { @{ ok=$false; msg=$_.Exception.Message } }
}
Check "GET /api/meta tts_configured" {
    try {
        $r = (Invoke-WebRequest -Uri "http://127.0.0.1:8080/api/meta" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
        if ($r.tts_configured) { @{ ok=$true } } else { @{ ok=$false; msg="ELEVENLABS_API_KEY missing" } }
    } catch { @{ ok=$false; msg=$_.Exception.Message } }
}
Check "GET /api/meta claude_configured" {
    try {
        $r = (Invoke-WebRequest -Uri "http://127.0.0.1:8080/api/meta" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
        if ($r.claude_configured) { @{ ok=$true } } else { @{ ok=$false; msg="CLAUDE_BIN not set (brain offline; library fallback only)" } }
    } catch { @{ ok=$false; msg=$_.Exception.Message } }
}

Write-Host ""
Write-Host "Tail of recent server log:" -ForegroundColor White
$log = Join-Path $ProjectRoot "state\logs\fishio-server.out.log"
if (Test-Path $log) {
    Get-Content $log -Tail 15 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
} else {
    Write-Host "  (no log yet — service not started)" -ForegroundColor DarkGray
}
