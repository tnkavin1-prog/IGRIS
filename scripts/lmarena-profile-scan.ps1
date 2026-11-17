# ============================================================================
#  lmarena-profile-scan.ps1 - find which Chrome profiles are logged into Arena
#
#  For each Chrome profile:
#    1. Kill Chrome
#    2. Launch via agent-desktop (junction + CDP port + profile + Arena URL)
#    3. Use lmarena.mjs status to check login/limit state
#    4. Report result
#
#  agent-desktop handles the browser launch/lifecycle; CDP handles page introspection
#  (Chrome does not expose web content via UI Automation, so CDP is required there).
#
#  Usage:
#    lmarena-profile-scan.ps1
#    lmarena-profile-scan.ps1 -Profiles "Profile 4","Profile 9"
# ============================================================================

param(
    [string[]]$Profiles,
    [int]$Port = 9222
)

$ErrorActionPreference = 'Continue'   # keep scanning even if one profile fails
$agentDesktop = "E:\IGRIS\.npm-global\bin\agent-desktop.cmd"
$chromeExe    = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$link         = "C:\Users\tnkav\AppData\Local\Temp\chrome-agent"
$driver       = "E:\Gemetron\scripts\lmarena.mjs"
$env:PATH     = $env:PATH + ';E:\IGRIS\.npm-global\bin'

if (-not $Profiles) {
    $Profiles = @('Profile 2', 'Profile 4', 'Profile 10', 'Profile 9', 'Profile 8', 'Profile 6', 'Profile 5', 'Profile 3', 'Default')
}

# ensure junction
if (-not (Test-Path $link)) { cmd /c mklink /J "$link" "C:\Users\tnkav\AppData\Local\Google\Chrome\User Data" | Out-Null }

function Kill-Chrome {
    Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $left = Get-Process chrome -ErrorAction SilentlyContinue
    if ($left) { $left | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
}

function Launch-Chrome {
    param([string]$Profile)
    $out = & $agentDesktop launch $chromeExe --no-attach `
        --arg="--user-data-dir=$link" `
        --arg="--profile-directory=$Profile" `
        --arg="--remote-debugging-port=$Port" `
        --arg="--no-first-run" `
        --arg="--no-default-browser-check" `
        --arg="https://arena.ai/text/direct?model_a=kimi-k3" `
        --activate --timeout=30000 2>&1
    $out | Out-String -Width 200
}

function Check-Status {
    $res = node $driver status 2>&1 | Out-String
    $start = $res.IndexOf('{')
    if ($start -lt 0) { return @{ ok=$false; note='no_json'; email=''; loggedIn=$false; limited=$false } }
    $j = $res.Substring($start) | ConvertFrom-Json -ErrorAction SilentlyContinue
    if (-not $j) { return @{ ok=$false; note='parse_fail'; email=''; loggedIn=$false; limited=$false } }
    $email = ''
    $m = [regex]::Match($j.bodyHead, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
    if ($m.Success) { $email = $m.Value }
    return @{
        ok=$true; email=$email; loggedIn=$j.loggedIn; limited=$j.limited;
        limitedMsg=$j.limitMsg; chips=$j.chips; bodyLen=$j.bodyLen; note=$j.note
    }
}

$results = @()

foreach ($p in $Profiles) {
    Write-Host "=== $p ===" -ForegroundColor Cyan
    Kill-Chrome
    Launch-Chrome -Profile $p | Out-Null
    Start-Sleep -Seconds 5

    $st = Check-Status
    $chromeEmail = ''
    try {
        $pref = Join-Path "C:\Users\tnkav\AppData\Local\Google\Chrome\User Data\$p" 'Preferences'
        $j = Get-Content $pref -Raw | ConvertFrom-Json
        $chromeEmail = $j.account_info[0].email
    } catch { }

    $results += [pscustomobject]@{
        Profile       = $p
        ChromeEmail   = $chromeEmail
        ArenaEmail    = if ($st.email) { $st.email } else { '' }
        LoggedIn      = [bool]$st.loggedIn
        Limited       = [bool]$st.limited
        LimitMsg      = if ($st.limitedMsg) { $st.limitedMsg } else { '' }
        LoggedInNote  = if (-not $st.ok) { $st.note } else { '' }
    }

    if ($st.loggedIn -and -not $st.limited) {
        Write-Host "  >>> $p IS LOGGED INTO ARENA (email: $($st.email))" -ForegroundColor Green
    } elseif ($st.limited) {
        Write-Host "  >>> $p limited: $($st.limitMsg)" -ForegroundColor Yellow
    } else {
        Write-Host "  >>> $p not logged in" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String -Width 200
