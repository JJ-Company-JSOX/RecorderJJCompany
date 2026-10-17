@echo off
setlocal
set "RECORDLY_DISABLE_AUTO_UPDATES=1"
set "RECORDLY_DIAGNOSTICS_USER_DATA=%APPDATA%\Jsox-test"
if not exist "%~dp0Recordly.exe" (
  echo Recordly.exe was not found beside this launcher.
  exit /b 1
)
start "" /d "%~dp0" "%~dp0Recordly.exe" %*
