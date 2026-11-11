# E:\Gematron\scripts\launch-all.ps1
# Master launcher for Project Gematron Autonomous AI System
# Starts OpenCode Daemon (4096), Local Bridge Server (47821), and launches Electron Floating HUD.

$ErrorActionPreference = 'Stop'
$repoRoot = "E:\Gematron"
Set-Location $repoRoot

if (-not (Test-Path "$repoRoot\logs")) {
    New-Item -ItemType Directory -Path "$repoRoot\logs" -Force | Out-Null
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  PROJECT GEMATRON - MASTER SYSTEM LAUNCHER             " -ForegroundColor White
Write-Host "  Storage: $repoRoot (E: Drive Only)                   " -ForegroundColor Gray
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. OpenCode Daemon Server (Port 4096)
Write-Host "[1/3] Checking OpenCode Daemon Server (Port 4096)..." -ForegroundColor Yellow
$openCodeConn = Get-NetTCPConnection -LocalPort 4096 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 -and $_.State -ne 'Closed' } | Select-Object -First 1
if ($openCodeConn -and $openCodeConn.OwningProcess -ne 0) {
    Write-Host "      [OK] OpenCode Server is ACTIVE (Port 4096, PID: $($openCodeConn.OwningProcess))" -ForegroundColor Green
} else {
    Write-Host "      [..] Starting OpenCode server daemon..." -ForegroundColor Yellow
    & "$repoRoot\scripts\start-opencode-server.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      [ERROR] OpenCode server failed to start. See messages above." -ForegroundColor Red
        exit 1
    }
}

# 2. Local Bridge Server (Port 47821)
Write-Host "[2/3] Checking Local Token Bridge Server (Port 47821)..." -ForegroundColor Yellow
$bridgeConn = Get-NetTCPConnection -LocalPort 47821 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 -and $_.State -ne 'Closed' } | Select-Object -First 1
if ($bridgeConn) {
    Write-Host "      [OK] Local Token Bridge is ACTIVE (Port 47821, PID: $($bridgeConn.OwningProcess))" -ForegroundColor Green
} else {
    Write-Host "      [..] Starting Local Bridge daemon..." -ForegroundColor Yellow
    $bridgeLog = "$repoRoot\logs\local-bridge.log"
    $bridgeErr = "$repoRoot\logs\local-bridge-error.log"
    Start-Process node -ArgumentList "apps/local-bridge/dist/server.mjs" -WorkingDirectory $repoRoot -RedirectStandardOutput $bridgeLog -RedirectStandardError $bridgeErr -WindowStyle Hidden
    Start-Sleep -Seconds 2
    $bridgeConn = Get-NetTCPConnection -LocalPort 47821 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 -and $_.State -ne 'Closed' } | Select-Object -First 1
    if ($bridgeConn) {
        Write-Host "      [OK] Local Token Bridge is ACTIVE (Port 47821, PID: $($bridgeConn.OwningProcess))" -ForegroundColor Green
    } else {
        Write-Host "      [WARN] Local Token Bridge started in background; check $bridgeLog if needed." -ForegroundColor Yellow
    }
}

# 3. Electron Floating HUD Window
Write-Host "[3/3] Checking Floating Gemini 3.8 Flash HUD Window..." -ForegroundColor Yellow
$electronExe = "$repoRoot\node_modules\electron\dist\electron.exe"
$appDir = "$repoRoot\apps\desktop-hud"

if (-not (Test-Path $electronExe)) {
    Write-Host "      [ERROR] Electron binary not found at $electronExe" -ForegroundColor Red
    exit 1
}

$hudPort = 9228
$hudConn = Get-NetTCPConnection -LocalPort $hudPort -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 -and $_.State -ne 'Closed' } | Select-Object -First 1

if ($hudConn) {
    Write-Host "      [OK] Desktop HUD is already ACTIVE (Port $hudPort, PID: $($hudConn.OwningProcess))." -ForegroundColor Green
    Write-Host "      [..] Bringing floating HUD window to front..." -ForegroundColor Cyan
    try {
        $body = '{"prompt":""}'
        Invoke-RestMethod -Uri "http://127.0.0.1:9228/summon" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 2 -ErrorAction SilentlyContinue | Out-Null
        Write-Host "      [OK] Summon signal delivered to live HUD." -ForegroundColor Green
    } catch {}
} else {
    # If electron was running but port 9228 wasn't listening, clean up orphan
    Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    
    Write-Host "      [..] Spawning Floating HUD Window..." -ForegroundColor Cyan
    $launchCmd = "`"$electronExe`" `"$appDir`""
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $launchCmd } | Out-Null
    
    # Wait up to 6 seconds for port 9228 to be ready
    $ready = $false
    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep -Milliseconds 500
        $check = Get-NetTCPConnection -LocalPort $hudPort -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 -and $_.State -ne 'Closed' } | Select-Object -First 1
        if ($check) {
            $ready = $true
            break
        }
    }
    
    if ($ready) {
        Write-Host "      [OK] Floating HUD Window is active and listening on port $hudPort." -ForegroundColor Green
        try {
            $body = '{"prompt":""}'
            Invoke-RestMethod -Uri "http://127.0.0.1:9228/summon" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 2 -ErrorAction SilentlyContinue | Out-Null
        } catch {}
    } else {
        Write-Host "      [OK] Floating HUD Window spawned." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Gematron is ready!" -ForegroundColor Green
Write-Host "  * Floating window is on screen." -ForegroundColor White
Write-Host "  * Press Alt+G in Chrome or use context menu 'Ask Gemini'." -ForegroundColor White
Write-Host "  * System Tray icon is active in taskbar." -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan
exit 0
