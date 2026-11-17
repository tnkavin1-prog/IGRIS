# ============================================================================
#  chrome-launch.ps1 - launch Chrome on a chosen profile WITH DevTools enabled
#
#  Chrome 136+ refuses --remote-debugging-port when --user-data-dir is the real
#  default profile directory. Passing an NTFS junction to that same directory
#  is accepted, so we get a fully scriptable Chrome that still has every saved
#  login, cookie and profile. No extension and no re-login required.
#
#  Usage:
#    chrome-launch.ps1 -List
#    chrome-launch.ps1 -Profile "Profile 4" -Url "https://arena.ai/text/direct"
#    chrome-launch.ps1 -CloseAll
# ============================================================================

param(
    [string]$Profile = 'Profile 2',
    [string]$Url = 'https://arena.ai/text/direct',
    [int]$Port = 9222,
    [switch]$List,
    [switch]$CloseAll,
    [switch]$NoWait
)

$ErrorActionPreference = 'Stop'
$Chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$RealData = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$LinkData = "$env:TEMP\chrome-agent"

function Get-ProfileInfo {
    Get-ChildItem $RealData -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' } |
        ForEach-Object {
            $email = ''
            $pref = Join-Path $_.FullName 'Preferences'
            if (Test-Path $pref) {
                try {
                    $j = Get-Content $pref -Raw -ErrorAction Stop | ConvertFrom-Json
                    $email = $j.account_info[0].email
                } catch { }
            }
            [pscustomobject]@{ Dir = $_.Name; Email = $email; LastUsed = $_.LastWriteTime }
        } | Sort-Object LastUsed -Descending
}

function Stop-Chrome {
    Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object {
        try { $_.CloseMainWindow() | Out-Null } catch { }
    }
    Start-Sleep -Seconds 3
    $left = Get-Process chrome -ErrorAction SilentlyContinue
    if ($left) {
        $left | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch { } }
        Start-Sleep -Seconds 2
    }
}

function Test-Cdp {
    param([int]$P)
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$P/json/version" -TimeoutSec 2 -UseBasicParsing
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Ensure-Junction {
    if (Test-Path $LinkData) {
        $item = Get-Item $LinkData -Force
        if ($item.LinkType -eq 'Junction') { return }
        cmd /c rmdir "$LinkData" 2>$null | Out-Null
    }
    cmd /c mklink /J "$LinkData" "$RealData" | Out-Null
    if (-not (Test-Path $LinkData)) { throw "could not create junction $LinkData" }
}

if ($List) {
    Get-ProfileInfo | Format-Table -AutoSize | Out-String -Width 140
    exit 0
}

if ($CloseAll) {
    Stop-Chrome
    Write-Output 'chrome_closed=1'
    exit 0
}

if (-not (Test-Path $Chrome)) { Write-Error "Chrome not found at $Chrome"; exit 1 }
if (-not (Test-Path (Join-Path $RealData $Profile))) { Write-Error "Profile not found: $Profile"; exit 1 }

Stop-Chrome
Ensure-Junction

$argstr = '--user-data-dir="' + $LinkData + '"' +
          ' --profile-directory="' + $Profile + '"' +
          " --remote-debugging-port=$Port" +
          ' --no-first-run --no-default-browser-check --disable-features=Translate' +
          ' --new-window "' + $Url + '"'

Start-Process -FilePath $Chrome -ArgumentList $argstr -WorkingDirectory (Split-Path $Chrome)
Write-Output "launched profile=$Profile port=$Port"

if ($NoWait) { exit 0 }

$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Cdp -P $Port) { $ok = $true; break }
}
Write-Output "cdp_ready=$([int]$ok)"
if (-not $ok) { exit 3 }
