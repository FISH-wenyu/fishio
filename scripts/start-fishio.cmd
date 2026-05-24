@echo off
rem ----------------------------------------------------------------------
rem  start-fishio.cmd - Fishio Node server wrapper (target of NSSM service
rem  fishio-server). Stays in the foreground; NSSM owns stdout/stderr
rem  redirection plus restart-on-crash.
rem
rem  IMPORTANT: this file MUST stay 100%% ASCII. cmd.exe reads .cmd files
rem  with the system ANSI code page (GBK / 936 on Chinese Windows), so any
rem  Unicode chars (em-dashes, arrows, Chinese) will corrupt the parser
rem  and silently break chcp / commands. Only comments via 'rem'.
rem ----------------------------------------------------------------------
setlocal

rem 65001 = UTF-8 console code page. Without it node's stdout (artist
rem names, weather degrees) is mojibake in cmd / NSSM log files.
chcp 65001 >nul 2>&1

rem Anchor cwd to repo root regardless of how the script was invoked.
cd /d "%~dp0.."

rem Suppress Node 22+ deprecation noise we've already handled explicitly.
set NODE_NO_WARNINGS=1

rem Absolute path beats PATH lookup - NSSM strips most user PATH entries
rem when running as LocalSystem.
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"

"%NODE_EXE%" --env-file=.env src\server.js
exit /b %ERRORLEVEL%
