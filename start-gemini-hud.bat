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
    echo Please run 'npm install' in E:\Gematron first.
    pause
    exit /b 1
)

set "TARGET_URL=%~1"
if "!TARGET_URL!"=="" (
    set "NORMALIZED_ROOT=!ROOT_DIR:\=/!"
    set "TARGET_URL=file:///!NORMALIZED_ROOT!SSC_CGL_Mock_Exam.html"
)

:: Find Chrome Executable
set "CHROME_EXE="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

:: 1. Ensure Chrome is running with Remote Debugging (port 9222)
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [1/2] Launching Google Chrome with remote debugging on port 9222...
    if defined CHROME_EXE (
        start "" "!CHROME_EXE!" --remote-debugging-port=9222 --user-data-dir="!ROOT_DIR!.chrome-debug-profile" --no-first-run --no-default-browser-check "!TARGET_URL!"
    ) else (
        echo [WARN] Google Chrome executable not found in standard paths. Desktop HUD will detect it on startup.
    )
    ping 127.0.0.1 -n 3 >nul
) else (
    echo [1/2] Google Chrome remote debugging is active on port 9222.
)

:: 2. Launch Native Desktop HUD (Electron)
echo [2/2] Launching Native Desktop Floating HUD...
start "" "!ELECTRON_EXE!" "!APP_DIR!"

echo [OK] Gemini Desktop HUD started.
exit /b 0
