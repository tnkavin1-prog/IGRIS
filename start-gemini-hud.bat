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

:: Register for Windows auto-start (login-item registration)
:: Validates executable path and repairs if changed on subsequent runs
set "AUTOSTART_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "AUTOSTART_VALUE=Gematron Desktop HUD"
set "AUTOSTART_DATA=!ELECTRON_EXE! !APP_DIR!"
for /f "tokens=3" %%a in ('reg query "%AUTOSTART_KEY%" /v "%AUTOSTART_VALUE%" 2^>nul') do set "EXISTING_DATA=%%a"
if not "!EXISTING_DATA!"=="!AUTOSTART_DATA!" (
    reg add "%AUTOSTART_KEY%" /v "%AUTOSTART_VALUE%" /d "!AUTOSTART_DATA!" /f >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] Auto-start registered: !AUTOSTART_VALUE!
    ) else (
        echo [WARN] Could not register auto-start (admin rights may be required)
    )
) else (
    echo [OK] Auto-start already registered
)

exit /b 0
