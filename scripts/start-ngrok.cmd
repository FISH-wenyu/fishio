@echo off
rem ----------------------------------------------------------------------
rem  start-ngrok.cmd - wraps 'ngrok http 8080' for the NSSM service
rem  fishio-ngrok. Reads NGROK_DOMAIN from .env so the tunnel binds to
rem  your reserved static URL every boot. Use --config to point at the
rem  ProgramData copy of ngrok.yml that LocalSystem can actually read
rem  (the installer copies it there from your user profile).
rem
rem  ASCII only - cmd.exe parses .cmd in system ANSI code page.
rem ----------------------------------------------------------------------
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0.."

set "NGROK_EXE=C:\Users\19547\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
if not exist "%NGROK_EXE%" set "NGROK_EXE=ngrok.exe"

set "NGROK_YML=C:\ProgramData\ngrok\ngrok.yml"

rem Parse NGROK_DOMAIN from .env without invoking node.
set "NGROK_DOMAIN="
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /I "%%a"=="NGROK_DOMAIN" set "NGROK_DOMAIN=%%b"
  )
)
if defined NGROK_DOMAIN set "NGROK_DOMAIN=!NGROK_DOMAIN:"=!"

if defined NGROK_DOMAIN (
  echo [start-ngrok] binding reserved domain: !NGROK_DOMAIN!
  "%NGROK_EXE%" http 8080 --config "%NGROK_YML%" --url=!NGROK_DOMAIN! --log=stdout --log-format=logfmt
) else (
  echo [start-ngrok] no NGROK_DOMAIN set, using random URL
  "%NGROK_EXE%" http 8080 --config "%NGROK_YML%" --log=stdout --log-format=logfmt
)
exit /b %ERRORLEVEL%
