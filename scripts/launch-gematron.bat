@echo off
setlocal
title GEMATRON - Autonomous AI Computer Intelligence

echo ========================================================
echo   PROJECT GEMATRON - MASTER SYSTEM LAUNCHER
echo   Autonomous AI Computer Intelligence System
echo   Gemini 3.8 Flash + OpenCode + DeepSeek + GLM
echo ========================================================
echo(

cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Gematron\scripts\launch-all.ps1"

if errorlevel 1 goto :failed

echo(
echo Launch sequence complete. Floating HUD is running.
timeout /t 3 /nobreak >nul 2>&1
exit /b 0

:failed
echo(
echo [ERROR] Gematron launcher encountered an error.
pause
exit /b 1
