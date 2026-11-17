$ErrorActionPreference = 'Stop'

$repoRoot = 'E:\Gemetron'
$icoPath = Join-Path $repoRoot 'assets\icons\jarvis.ico'
$targetBat = Join-Path $repoRoot 'start-gemini-hud.bat'

$desktops = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:USERPROFILE 'Desktop')
) | Select-Object -Unique | Where-Object { Test-Path $_ }

$wscript = New-Object -ComObject WScript.Shell

foreach ($desktop in $desktops) {
    Write-Output "Configuring desktop at: $desktop"
    
    # 1. Remove old JARVIS shortcuts if they exist
    $oldShortcuts = @(
        (Join-Path $desktop 'JARVIS AI Assistant.lnk'),
        (Join-Path $desktop 'JARVIS.lnk'),
        (Join-Path $desktop 'J.A.R.V.I.S.lnk')
    )
    foreach ($old in $oldShortcuts) {
        if (Test-Path $old) {
            Remove-Item $old -Force
            Write-Output "  Removed old shortcut: $old"
        }
    }
    
    # 2. Create the shortcut named "igris.bat.lnk" so it displays as "igris.bat" on the desktop
    $shortcutPath = Join-Path $desktop 'igris.bat.lnk'
    $sc = $wscript.CreateShortcut($shortcutPath)
    $sc.TargetPath = $targetBat
    $sc.WorkingDirectory = $repoRoot
    $sc.IconLocation = "$icoPath,0"
    $sc.Description = "IGRIS AI Assistant - Autonomous Desktop HUD"
    $sc.Hotkey = "Ctrl+Alt+J"
    $sc.Save()
    Write-Output "  Created shortcut with new icon: $shortcutPath"
    
    # 3. Also create/update igris.bat directly in the desktop folder
    $desktopBat = Join-Path $desktop 'igris.bat'
    $batContent = "@echo off`r`ncd /d `"$repoRoot`"`r`ncall `"$targetBat`" %*`r`n"
    [System.IO.File]::WriteAllText($desktopBat, $batContent)
    Write-Output "  Created batch launcher: $desktopBat"
}

# 4. Notify Windows shell to immediately reload icon cache
$csharp = @"
using System;
using System.Runtime.InteropServices;
public class WinShell {
    [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@
Add-Type -TypeDefinition $csharp
[WinShell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero) # SHCNE_ASSOCCHANGED
Write-Output "Windows Explorer icon cache refresh notified successfully."
