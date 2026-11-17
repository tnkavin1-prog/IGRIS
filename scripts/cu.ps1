# ============================================================================
#  cu.ps1 - Gemetron computer-use CLI (drives AutoHotkey v2)
#
#  SAFETY MODEL
#    - Keyboard actions (type/keys/grab) REQUIRE an expected target window.
#      If the foreground window does not match, the action is refused.
#    - Window lookup is EXACT by default; pass "sub" as the last focus arg
#      for substring matching.
#
#  Usage:
#    cu.ps1 shot [window-substring] [-Gray]
#    cu.ps1 wins
#    cu.ps1 click <x> <y> [Left|Right|Middle] [count]
#    cu.ps1 dblclick <x> <y>
#    cu.ps1 type "<text>" "<expected-title-or-class>"
#    cu.ps1 keys "<sequence>" "<expected-title-or-class>"
#    cu.ps1 focus "<title>" [timeout] [exact|sub]
#    cu.ps1 scroll <x> <y> <ticks>
#    cu.ps1 drag <x1> <y1> <x2> <y2> [button]
#    cu.ps1 launch <command>
#    cu.ps1 grab "<expected-title-or-class>"
#    cu.ps1 run <job.ahk> [args...]
# ============================================================================

param(
    [Parameter(Position = 0)][string]$Command = 'wins',
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$Ahk     = 'E:\AutoHotkey\AutoHotkey64.exe'
$GemDir  = 'E:\AutoHotkey\gem'
$Result  = Join-Path $GemDir 'result.txt'
$ShotDir = 'C:\Users\tnkav\AppData\Local\Temp\opencode\shots'

if (-not (Test-Path $Ahk)) { Write-Error "AutoHotkey not found at $Ahk"; exit 1 }
if (-not $Rest) { $Rest = @() }

function Clear-StaleGemAhk {
    # Only kill our own transient job processes, never unrelated AHK daemons.
    Get-CimInstance Win32_Process -Filter "Name='AutoHotkey64.exe' OR Name='AutoHotkey32.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$GemDir*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Invoke-AhkJob {
    param([string]$Script, [string[]]$JobArgs = @())

    Clear-StaleGemAhk
    if (Test-Path $Result) { Remove-Item $Result -Force -ErrorAction SilentlyContinue }

    $argList = @("`"$Script`"") + ($JobArgs | ForEach-Object { "`"$($_ -replace '"', '\"')`"" })
    # NOTE: must be ONE command-line string. Passing a PowerShell array to
    # -ArgumentList silently strips '^', which corrupts AHK send-syntax keys.
    $cmdLine = $argList -join ' '
    $p = Start-Process -FilePath $Ahk -ArgumentList $cmdLine -WorkingDirectory $GemDir -Wait -PassThru -WindowStyle Hidden

    $lines = @()
    if (Test-Path $Result) { $lines = Get-Content $Result -Encoding UTF8 }

    [pscustomobject]@{ ExitCode = $p.ExitCode; Lines = $lines }
}

function Show-Result {
    param($r)
    foreach ($l in $r.Lines) { Write-Output $l }
    if ($r.ExitCode -ne 0 -and -not ($r.Lines -match '^DONE=')) {
        Write-Output "EXIT_CODE=$($r.ExitCode)"
    }
}

function Need-Args {
    param([int]$Count, [string]$Usage)
    if ($Rest.Count -lt $Count) { Write-Error "usage: cu.ps1 $Usage"; exit 1 }
}

switch ($Command.ToLower()) {

    'wins' {
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'wins.ahk'))
    }

    'shot' {
        if (-not (Test-Path $ShotDir)) { New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null }
        $out = Join-Path $ShotDir ("shot-" + (Get-Date -Format 'HHmmss') + ".png")
        $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'E:\Gemetron\scripts\screen-capture.ps1', '-Out', $out)
        $windowArg = $Rest | Where-Object { $_ -and $_ -ne '-Gray' } | Select-Object -First 1
        if ($windowArg) { $psArgs += @('-Window', $windowArg) }
        if ($Rest -contains '-Gray') { $psArgs += '-Gray' }
        & powershell.exe @psArgs | Out-Null
        Write-Output $out
    }

    'click' {
        Need-Args 2 'click <x> <y> [button] [count]'
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'click.ahk') -JobArgs $Rest)
    }

    'dblclick' {
        Need-Args 2 'dblclick <x> <y>'
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'click.ahk') -JobArgs @($Rest[0], $Rest[1], 'Left', '2'))
    }

    'type' {
        Need-Args 2 'type "<text>" "<expected-title-or-class>"'
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'type.ahk') -JobArgs $Rest)
    }

    'keys' {
        Need-Args 2 'keys "<sequence>" "<expected-title-or-class>"'
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'keys.ahk') -JobArgs $Rest)
    }

    'focus' {
        Need-Args 1 'focus "<title>" [timeout] [exact|sub]'
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'focus.ahk') -JobArgs $Rest)
    }

    'scroll' {
        Need-Args 3 'scroll <x> <y> <ticks>'
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'scroll.ahk') -JobArgs $Rest)
    }

    'drag' {
        Need-Args 4 'drag <x1> <y1> <x2> <y2> [button]'
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'drag.ahk') -JobArgs $Rest)
    }

    'launch' {
        Need-Args 1 'launch <command>'
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'launch.ahk') -JobArgs $Rest)
    }

    'grab' {
        Need-Args 1 'grab "<expected-title-or-class>"'
        Add-Type -AssemblyName System.Windows.Forms
        try { [System.Windows.Forms.Clipboard]::Clear() } catch { }
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'keys.ahk') -JobArgs @('^a', $Rest[0]))
        Start-Sleep -Milliseconds 150
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'keys.ahk') -JobArgs @('^c', $Rest[0]))
        Start-Sleep -Milliseconds 250
        $txt = Get-Clipboard -Raw
        Write-Output "LEN=$($txt.Length)"
        Write-Output $txt
    }

    'run' {
        Need-Args 1 'run <job.ahk> [args...]'
        $script = $Rest[0]
        if (-not (Test-Path $script)) { $script = Join-Path $GemDir $Rest[0] }
        $jobArgs = @()
        if ($Rest.Count -gt 1) { $jobArgs = $Rest[1..($Rest.Count - 1)] }
        Show-Result (Invoke-AhkJob -Script $script -JobArgs $jobArgs)
    }

    'do' {
        Need-Args 1 'do --into "<title>" [--sub] <actions...>'
        Show-Result (Invoke-AhkJob -Script (Join-Path $GemDir 'do.ahk') -JobArgs $Rest)
    }

    default {
        Write-Output 'commands: shot | wins | click | dblclick | type | keys | focus | scroll | drag | launch | grab | run'
    }
}
