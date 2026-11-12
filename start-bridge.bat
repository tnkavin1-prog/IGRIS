@echo off
title Gemini Browser Live - Local Bridge
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-bridge.ps1"
pause
