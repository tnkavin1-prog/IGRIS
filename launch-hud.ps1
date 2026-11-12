# Gemini Browser Live — Native Desktop Floating HUD Launcher
$ErrorActionPreference = 'Stop'

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Gemini Browser Live - Native Floating HUD Launcher    " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Locate Chrome executable
$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chromeExe = $null
foreach ($path in $chromePaths) {
    if (Test-Path $path) {
        $chromeExe = $path
        break
    }
}

if (-not $chromeExe) {
    Write-Host "[Error] Google Chrome executable was not found." -ForegroundColor Red
    exit 1
}

# 2. Locate active profile where extension is installed
$targetProfile = "Profile 2"
try {
    Get-ChildItem -Path "$env:LOCALAPPDATA\Google\Chrome\User Data" -Filter "Secure Preferences" -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object {
        $text = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
        if ($text -like "*release\chrome-extension*" -or $text -like "*hhbdkheccnmpbdadhhppbemcjkaimlob*") {
            $targetProfile = $_.Directory.Name
        }
    }
} catch {
    $targetProfile = "Profile 2"
}

$extId = "hhbdkheccnmpbdadhhppbemcjkaimlob"
$hudUrl = "chrome-extension://$extId/overlay.html"

# 3. Check if existing HUD window is already running (Strict Singleton)
$dllPath = Join-Path $PSScriptRoot "scripts\Win32Pin.dll"
$csPath = Join-Path $PSScriptRoot "scripts\Win32Pin.cs"
if (Test-Path $dllPath) {
    try {
        Add-Type -Path $dllPath -ErrorAction SilentlyContinue
    } catch {}
} elseif (Test-Path $csPath) {
    try {
        Add-Type -Path $csPath -ErrorAction SilentlyContinue
    } catch {}
}
$existingHwnd = [IntPtr]::Zero
try {
    $existingHwnd = [Gemetron.WindowPin]::FindWindowBySubstring("Gemini Browser Live")
} catch {}

if ($existingHwnd -ne [IntPtr]::Zero) {
    Write-Host "[Singleton] Gemini Floating HUD is already open. Re-focusing and pinning always-on-top..." -ForegroundColor Cyan
    try {
        [Gemetron.WindowPin]::PinTopMost("Gemini Browser Live")
    } catch {}
    exit 0
}

Write-Host "[1/3] Chrome located at: $chromeExe (Profile: $targetProfile)" -ForegroundColor Gray
Write-Host "[2/3] Launching Floating HUD ($hudUrl)..." -ForegroundColor Green

# 4. Launch Chrome in App mode
Start-Process -FilePath $chromeExe -ArgumentList @(
    "--profile-directory=$targetProfile",
    "--app=$hudUrl",
    "--window-size=440,680",
    "--window-position=1000,80"
)

Write-Host "[3/3] Pinning window on top of Chrome and desktop..." -ForegroundColor Gray

# 5. Pin Window TopMost
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Milliseconds 300
    try {
        $pinned = [Gemetron.WindowPin]::PinTopMost("Gemini Browser Live")
        if ($pinned -eq $true) {
            Write-Host "[OK] Gemini Floating HUD pinned successfully (Always-on-Top)!" -ForegroundColor Cyan
            break
        }
    } catch {}
}
