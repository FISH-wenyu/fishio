# uninstall-services.ps1 — removes every Fishio NSSM service. Leaves your
# .env, state\state.json, cache/tts/ and logs untouched.
#
# Usage:   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uninstall-services.ps1
# Or:      npm run service:uninstall

$ErrorActionPreference = "Stop"
$names = @("fishio-server", "fishio-ngrok", "fishio-cloudflared")

$me = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($me)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[X] Must run as Administrator." -ForegroundColor Red; exit 1
}

$nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source
if (-not $nssm) { Write-Host "[X] nssm.exe not on PATH." -ForegroundColor Red; exit 1 }

foreach ($n in $names) {
    $svc = Get-Service -Name $n -ErrorAction SilentlyContinue
    if (-not $svc) { Write-Host "[ ] $n — not installed, skip" -ForegroundColor DarkGray; continue }
    if ($svc.Status -ne 'Stopped') {
        Write-Host "[*] Stopping $n..." -ForegroundColor Cyan
        Stop-Service -Name $n -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
    Write-Host "[*] Removing $n..." -ForegroundColor Cyan
    & $nssm remove $n confirm | Out-Null
}
Write-Host "[+] Done. Logs under state\logs\ kept for reference." -ForegroundColor Green
