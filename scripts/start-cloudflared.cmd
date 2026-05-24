@echo off
rem ----------------------------------------------------------------------
rem  start-cloudflared.cmd - wraps cloudflared quick tunnel for NSSM
rem  service fishio-cloudflared. Each restart produces a NEW random URL
rem  (quick tunnels are stateless). Watch state\logs\fishio-cloudflared.out.log
rem  for the current https://*.trycloudflare.com line.
rem
rem  For a STABLE URL see docs/autostart.md "Named Cloudflare tunnel".
rem
rem  ASCII only - cmd.exe parses .cmd in system ANSI code page.
rem ----------------------------------------------------------------------
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0.."

set "CF_EXE=C:\Users\19547\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
if not exist "%CF_EXE%" set "CF_EXE=cloudflared.exe"

"%CF_EXE%" tunnel --url http://localhost:8080 --no-autoupdate --loglevel info
exit /b %ERRORLEVEL%
