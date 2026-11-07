# Launcher for Gemini Browser Live Local Bridge (Strictly E: Drive)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host '==========================================================' -ForegroundColor Cyan
Write-Host '       Gemini Browser Live — Local Token Bridge           ' -ForegroundColor Green
Write-Host '==========================================================' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Error: Node.js is not found on your PATH.' -ForegroundColor Red
    exit 1
}

$envFile = Join-Path $root 'apps\local-bridge\.env'
if (-not (Test-Path $envFile)) {
    Write-Host "Error: .env configuration not found at $envFile." -ForegroundColor Red
    exit 1
}

$gateSecret = (Get-Content $envFile | Where-Object { $_ -match '^LOCAL_GATE_SECRET=' } | ForEach-Object { $_ -replace '^LOCAL_GATE_SECRET=','' }).Trim()
$extensionId = (Get-Content $envFile | Where-Object { $_ -match '^ALLOWED_EXTENSION_IDS=' } | ForEach-Object { $_ -replace '^ALLOWED_EXTENSION_IDS=','' }).Trim()

Write-Host '  Location:      E:\Gemetron' -ForegroundColor Gray
Write-Host ('  Extension ID:  ' + $extensionId) -ForegroundColor Yellow
Write-Host ('  Gate Secret:   ' + $gateSecret) -ForegroundColor White
Write-Host '==========================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host 'HOW TO CONNECT IN CHROME:' -ForegroundColor Yellow
Write-Host '  1. Open Chrome -> chrome://extensions'
Write-Host "  2. Enable 'Developer mode' (top-right toggle)"
Write-Host "  3. Click 'Load unpacked' and select:" -ForegroundColor White
Write-Host '     E:\Gemetron\release\chrome-extension' -ForegroundColor Cyan
Write-Host '  4. In Chrome, press Alt+Shift+S (or click the extension icon)'
Write-Host '  5. Go to Settings -> Bridge Secret and paste the secret above'
Write-Host ''
Write-Host 'Starting bridge server on port 47821... (Press Ctrl+C to stop)' -ForegroundColor Green
Write-Host ''

Set-Location $root
node apps/local-bridge/dist/server.mjs
