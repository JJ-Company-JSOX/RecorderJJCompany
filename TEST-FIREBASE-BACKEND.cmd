@echo off
setlocal
cd /d "%~dp0cloud\functions"
title Jsox Firebase Backend - Local Tests Only
echo This installs backend development dependencies and runs LOCAL tests.
echo Approximate Linux dev install: 295 MB plus temporary CLI; Windows size may differ.
echo No cloud deployment, API call or AI model download is performed.
echo Rules emulators require Java 21+ and an official Google download.
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 22 first.
 pause
 exit /b 1
)
where java >nul 2>nul
if errorlevel 1 (
 echo Install Java 21 or newer before running emulator tests.
 pause
 exit /b 1
)
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto failed
call npm.cmd test
if errorlevel 1 goto failed
call npm.cmd run test:emulators
if errorlevel 1 goto failed
echo All local backend tests completed. Nothing was deployed.
pause
exit /b 0
:failed
echo A check failed. Keep the error output and send a screenshot.
pause
exit /b 1
