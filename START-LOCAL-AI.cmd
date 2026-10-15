@echo off
setlocal
cd /d "%~dp0"
title Jsox Recorder - Local AI Service
where ollama >nul 2>nul
if errorlevel 1 (
 echo Ollama is not installed or not on PATH. See docs\jsox-visual-ai-test.md
 pause
 exit /b 1
)
echo This starts local Ollama only. No models are downloaded.
echo Quit any existing Ollama tray service first. Keep this window open.
set OLLAMA_HOST=127.0.0.1:11434
set OLLAMA_NO_CLOUD=1
call ollama serve
pause
