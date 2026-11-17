# ============================================================================
#  lmarena-scan.ps1 - find which Chrome profiles already have an Arena session
#
#  For every Chrome profile it launches the profile with DevTools enabled (see
#  chrome-launch.ps1), opens arena.ai and reports:
#    profile, chrome account email, arena logged-in state, arena email, limit
#
#  Usage:
#    lmarena-scan.ps1
#    lmarena-scan.ps1 -Profiles "Profile 4","Profile 9"
# ============================================================================

param(
    [string[]]$Profiles,
    [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$launch = Join-Path $PSScriptRoot 'chrome-launch.ps1'
$driver = Join-Path $PSScriptRoot 'lmarena.mjs'

if (-not $Profiles) {
    $Profiles = @('Profile 2', 'Profile 4', 'Profile 10', 'Profile 9', 'Profile 8', 'Profile 6', 'Profile 5', 'Profile 3', 'Default')
}

$probe = @'
(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const body = clean(document.body ? (document.body.innerText || document.body.textContent || '') : '');
  const m = body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return {
    url: location.href,
    title: document.title,
    loggedIn: !!m,
    email: m ? m[0] : null,
    limited: /daily usage limit|out of credits|reached your limit/i.test(body),
    limitMsg: (body.match(/You've reached[^.]*\./) || [null])[0],
    hasComposer: !!document.querySelector('textarea'),
    len: body.length,
  };
})()
'@

$results = @()

foreach ($p in $Profiles) {
    Write-Host "--- $p ---"
    & $launch -Profile $p -Url 'https://arena.ai/text/direct' -Port $Port | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $results += [pscustomobject]@{ Profile = $p; Email = ''; ArenaEmail = ''; LoggedIn = $false; Limited = $false; Note = 'cdp_failed' }
        continue
    }
    Start-Sleep -Seconds 4
    $json = & node $driver eval $probe 2>&1 | Out-String
    $note = ''
    $obj = $null
    try {
        $start = $json.IndexOf('{')
        if ($start -ge 0) { $obj = $json.Substring($start) | ConvertFrom-Json }
    } catch { $note = 'parse_failed' }

    $chromeEmail = ''
    try {
        $pref = Join-Path "$env:LOCALAPPDATA\Google\Chrome\User Data\$p" 'Preferences'
        $j = Get-Content $pref -Raw | ConvertFrom-Json
        $chromeEmail = $j.account_info[0].email
    } catch { }

    if ($obj) {
        $results += [pscustomobject]@{
            Profile = $p
            Email = $chromeEmail
            ArenaEmail = if ($obj.email) { $obj.email } else { '' }
            LoggedIn = [bool]$obj.loggedIn
            Limited = [bool]$obj.limited
            Note = if ($obj.limitMsg) { $obj.limitMsg } else { $note }
        }
    } else {
        $results += [pscustomobject]@{ Profile = $p; Email = $chromeEmail; ArenaEmail = ''; LoggedIn = $false; Limited = $false; Note = 'probe_failed' }
    }
}

Write-Host ''
$results | Format-Table -AutoSize | Out-String -Width 200
