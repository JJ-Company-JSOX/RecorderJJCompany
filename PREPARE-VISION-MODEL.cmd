@echo off
setlocal
cd /d "%~dp0"
title Jsox Recorder - Optional Vision Model
where ollama >nul 2>nul
if errorlevel 1 (
 echo Install Ollama first: https://ollama.com/download
 pause
 exit /b 1
)
echo Optional model: qwen3-vl:4b. Expected download: several GB; exact size unverified.
echo Check the current download size and model terms BEFORE continuing:
echo https://ollama.com/library/qwen3-vl:4b
echo Upstream source: Apache-2.0. Verify the selected weights' terms separately.
echo CPU and GPU speed on your computer has NOT been benchmarked.
echo This downloads a model from the model registry, not your videos.
echo Do not continue if you cannot accept the download size or model terms.
choice /c YN /n /m "Download this optional model? [Y/N]: "
if errorlevel 2 exit /b 0
call ollama pull qwen3-vl:4b
if errorlevel 1 (
 echo Model download failed. Keep the original error for troubleshooting.
 pause
 exit /b 1
)
call ollama show qwen3-vl:4b
call ollama show qwen3-vl:4b --license
pause
