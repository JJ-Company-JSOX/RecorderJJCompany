@echo off
setlocal
cd /d "%~dp0"
title Jsox Recorder - Desktop Preview
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 22 or newer from https://nodejs.org/ then reopen this file.
 pause
 exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
 echo Node.js 22 or newer is required.
 pause
 exit /b 1
)
set WHISPER_RUNTIME_ALLOW_MISSING=1
if not exist "node_modules\.bin\vite.cmd" (
 call npm.cmd ci --no-audit --no-fund
 if errorlevel 1 (
  echo Dependency installation failed. Send a screenshot of the first error.
  pause
  exit /b 1
 )
)
echo Starting Jsox desktop. Keep this window open.
echo AI models are NOT installed or downloaded by this script.
call npm.cmd run dev
pause
