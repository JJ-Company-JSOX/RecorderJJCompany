@echo off
setlocal
set "RECORDLY_DEV_OPEN_RECORDING_INPUT="
set "RECORDLY_DEV_OPEN_RECORDING_WEBCAM="
set "RECORDLY_SMOKE_EXPORT="
set "RECORDLY_DISABLE_AUTO_UPDATES=1"
set "RECORDLY_DIAGNOSTICS_USER_DATA=%APPDATA%\Jsox-offline-speech-ui-test"
if not exist "%~dp0Recordly.exe" (
  echo Recordly.exe was not found beside this launcher.
  exit /b 1
)
start "" /d "%~dp0" "%~dp0Recordly.exe" %*
