@echo off
title Gemini Browser Live - Native Desktop HUD
setlocal enabledelayedexpansion

echo ==========================================================
echo    Gemini Browser Live - Native Desktop Floating HUD
echo    Option A (Standalone Electron App - 100%% Extension-Free)
echo ==========================================================

set "ROOT_DIR=%~dp0"
set "ELECTRON_EXE=%ROOT_DIR%node_modules\electron\dist\electron.exe"
set "APP_DIR=%ROOT_DIR%apps\desktop-hud"

if not exist "!ELECTRON_EXE!" (
    echo [ERROR] Electron executable was not found at:
    echo   !ELECTRON_EXE!
    echo Please run 'npm install' in !ROOT_DIR! first.
    pause
    exit /b 1
)

:: Launch Native Desktop HUD (Electron) directly - no Chrome needed
echo [1/1] Launching Native Desktop Floating HUD...
start "" "!ELECTRON_EXE!" "!APP_DIR!"

echo [OK] Gemini Desktop HUD started.
exit /b 0
