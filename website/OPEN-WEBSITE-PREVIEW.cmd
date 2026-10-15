@echo off
setlocal
cd /d "%~dp0"
title Jsox Recorder - Website Preview
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js is missing. Install Node.js LTS, then reopen this file.
 pause
 exit /b 1
)
echo This uploads only the Jsox website to a 7-day Firebase preview.
echo Project: d-recorder-ef064
echo No desktop installer or voice cloning is included.
echo Existing live website will not be replaced.
echo.
call npx firebase-tools hosting:channel:deploy jsox-review --expires 7d --project d-recorder-ef064
if errorlevel 1 (
 echo.
 echo Upload failed. Send a screenshot of the error, without login tokens.
 pause
 exit /b 1
)
echo.
echo Preview is ready. Open the Hosting URL printed above.
echo Send that URL back in the chat for review.
pause
