<#
.SYNOPSIS
    Launches Google Chrome with Remote Debugging enabled on port 9222 for LMSYS Chatbot Arena Kimi K3 Bridge.
.DESCRIPTION
    Checks if port 9222 is already listening. If active, reports ready status.
    If not listening, locates the Chrome executable and launches it with:
      --remote-debugging-port=9222
      --user-data-dir="C:\ChromeAgentProfile"
    and opens the target Arena tab.
.PARAMETER Port
    Remote debugging port (default: 9222).
.PARAMETER UserDataDir
    Chrome profile directory (default: C:\ChromeAgentProfile).
.PARAMETER Url
    Target URL to open (default: https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652).
.PARAMETER TimeoutSec
    Maximum seconds to wait for port to become active (default: 15).
#>

[CmdletBinding()]
param (
    [int]$Port = 9222,
    [string]$UserDataDir = (Join-Path (Split-Path -Parent $PSScriptRoot) ".chrome-debug-profile"),
    [string]$Url = "https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652",
    [int]$TimeoutSec = 15
)

function Test-PortListening {
    param ([int]$TargetPort)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $TargetPort, $null, $null)
        $success = $iar.AsyncWaitHandle.WaitOne(800, $false)
        if ($success -and $client.Connected) {
            $client.EndConnect($iar)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

Write-Host "[ChromeLauncher] Checking Chrome remote debugging status on 127.0.0.1:$Port..." -ForegroundColor Cyan

if (Test-PortListening -TargetPort $Port) {
    Write-Host "[ChromeLauncher] Chrome is already listening on remote debugging port $Port." -ForegroundColor Green
    exit 0
}

Write-Host "[ChromeLauncher] Port $Port is not listening. Searching for Chrome executable..." -ForegroundColor Yellow

$possiblePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)

$chromePath = $null
foreach ($p in $possiblePaths) {
    if (Test-Path $p) {
        $chromePath = $p
        break
    }
}

if (-not $chromePath) {
    $cmd = Get-Command "chrome.exe" -ErrorAction SilentlyContinue
    if ($cmd) {
        $chromePath = $cmd.Source
    }
}

if (-not $chromePath) {
    Write-Error "[ChromeLauncher] Error: Could not locate chrome.exe on this system."
    exit 1
}

Write-Host "[ChromeLauncher] Located Chrome at: $chromePath" -ForegroundColor DarkCyan

if (-not (Test-Path $UserDataDir)) {
    Write-Host "[ChromeLauncher] Creating profile directory: $UserDataDir" -ForegroundColor DarkCyan
    New-Item -ItemType Directory -Path $UserDataDir -Force | Out-Null
}

$chromeArgs = @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=`"$UserDataDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    $Url
)

Write-Host "[ChromeLauncher] Starting Chrome with flags:" -ForegroundColor Cyan
Write-Host "  Port: $Port"
Write-Host "  Profile: $UserDataDir"
Write-Host "  URL: $Url"

Start-Process -FilePath $chromePath -ArgumentList $chromeArgs

Write-Host "[ChromeLauncher] Waiting for port $Port to open (timeout: ${TimeoutSec}s)..." -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()

while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    Start-Sleep -Milliseconds 500
    if (Test-PortListening -TargetPort $Port) {
        $sw.Stop()
        Write-Host "[ChromeLauncher] Chrome remote debugging is active on port $Port! (Ready in $($sw.Elapsed.TotalMilliseconds)ms)" -ForegroundColor Green
        exit 0
    }
}

$sw.Stop()
Write-Error "[ChromeLauncher] Timeout: Port $Port did not start listening within $TimeoutSec seconds."
exit 1
