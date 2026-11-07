<#
.SYNOPSIS
  Automated Windows Desktop Shortcut Generator for JARVIS AI Assistant.

.DESCRIPTION
  Creates a high-resolution Windows shortcut (.lnk) pointing to E:\Gemetron\start-gemini-hud.bat
  configured with global summon hotkey Ctrl+Alt+J and custom brand iconography.

.PARAMETER Destination
  Target file path or directory for the shortcut. Defaults to E:\Gemetron\JARVIS AI Assistant.lnk,
  or the user's Desktop if -Desktop switch is supplied.

.PARAMETER Desktop
  If specified, writes the shortcut directly to the current user's Windows Desktop directory.

.PARAMETER TargetPath
  Executable or batch script to launch. Defaults to E:\Gemetron\start-gemini-hud.bat.

.PARAMETER WorkingDirectory
  Working directory for the process. Defaults to E:\Gemetron.

.PARAMETER Hotkey
  Keyboard hotkey combination. Defaults to Ctrl+Alt+J.

.PARAMETER IconPath
  Path to icon file (.ico). Defaults to E:\Gemetron\assets\icons\jarvis.ico.

.PARAMETER Description
  Shortcut description/tooltip.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/create-desktop-shortcut.ps1 -Desktop
#>

[CmdletBinding()]
param(
  [string]$Destination,
  [switch]$Desktop,
  [string]$TargetPath,
  [string]$WorkingDirectory,
  [string]$Hotkey = 'Ctrl+Alt+J',
  [string]$IconPath,
  [string]$Description = 'JARVIS AI Assistant - Autonomous Real-time Desktop HUD',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

# 1. Resolve TargetPath
if (-not $TargetPath) {
  $TargetPath = Join-Path $repoRoot 'start-gemini-hud.bat'
}
if (-not (Test-Path $TargetPath)) {
  Write-Warning "Target path does not exist yet: $TargetPath"
}

# 2. Resolve WorkingDirectory
if (-not $WorkingDirectory) {
  $WorkingDirectory = $repoRoot
}

# 3. Resolve IconPath
if (-not $IconPath) {
  $candidateIcon = Join-Path $repoRoot 'assets\icons\jarvis.ico'
  if (Test-Path $candidateIcon) {
    $IconPath = $candidateIcon
  } else {
    $candidateIcon2 = Join-Path $repoRoot 'assets\jarvis.ico'
    if (Test-Path $candidateIcon2) {
      $IconPath = $candidateIcon2
    }
  }
}

# 4. Determine Destination File Path
$shortcutName = 'JARVIS AI Assistant.lnk'
$finalPath = ''

if ($Desktop) {
  $desktopDir = [Environment]::GetFolderPath('Desktop')
  $finalPath = Join-Path $desktopDir $shortcutName
} elseif ($Destination) {
  if (Test-Path $Destination -PathType Container) {
    $finalPath = Join-Path $Destination $shortcutName
  } elseif ($Destination.EndsWith('.lnk', [System.StringComparison]::OrdinalIgnoreCase)) {
    $finalPath = $Destination
  } else {
    $finalPath = Join-Path $Destination $shortcutName
  }
} else {
  # Default location on E: drive
  $finalPath = Join-Path $repoRoot $shortcutName
}

$parentDir = Split-Path -Parent $finalPath
if ($parentDir -and -not (Test-Path $parentDir)) {
  New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
}

# 5. Create Shortcut via Windows Script Host COM Object
try {
  $wshShell = New-Object -ComObject WScript.Shell
  $shortcut = $wshShell.CreateShortcut($finalPath)

  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  if ($Hotkey) {
    $shortcut.Hotkey = $Hotkey
  }
  if ($IconPath -and (Test-Path $IconPath)) {
    $shortcut.IconLocation = "$IconPath,0"
  }
  $shortcut.WindowStyle = 1 # Normal window

  $shortcut.Save()

  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wshShell) | Out-Null

  $result = [PSCustomObject]@{
    Success          = $true
    ShortcutPath     = $finalPath
    TargetPath       = $TargetPath
    WorkingDirectory = $WorkingDirectory
    Hotkey           = $Hotkey
    IconLocation     = if ($IconPath) { "$IconPath,0" } else { $null }
    Description      = $Description
  }

  Write-Host "==========================================================" -ForegroundColor Cyan
  Write-Host "  JARVIS AI Assistant - Desktop Shortcut Generated" -ForegroundColor Green
  Write-Host "==========================================================" -ForegroundColor Cyan
  Write-Host "  Shortcut Location : $($result.ShortcutPath)" -ForegroundColor White
  Write-Host "  Target Executable : $($result.TargetPath)" -ForegroundColor White
  Write-Host "  Working Directory : $($result.WorkingDirectory)" -ForegroundColor White
  Write-Host "  Global Hotkey     : $($result.Hotkey)" -ForegroundColor Yellow
  Write-Host "  Icon Resource     : $($result.IconLocation)" -ForegroundColor White
  Write-Host "==========================================================" -ForegroundColor Cyan

  return $result
} catch {
  Write-Error "Failed to generate shortcut at '$finalPath': $_"
  exit 1
}
