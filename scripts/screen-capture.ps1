# Screen capture helper for Gemetron computer-use.
# Usage:
#   powershell -File screen-capture.ps1 -Out "E:\path\shot.png"
#   powershell -File screen-capture.ps1 -Out "...\shot.png" -X 0 -Y 0 -W 800 -H 600
#   powershell -File screen-capture.ps1 -Out "...\shot.png" -Window "Notepad"

param(
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$X = -1,
    [int]$Y = -1,
    [int]$W = -1,
    [int]$H = -1,
    [string]$Window = '',
    [switch]$Gray
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class GemDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[GemDpi]::SetProcessDPIAware() | Out-Null

# Resolve a window rect by title substring if requested
if ($Window -ne '') {
    $proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*$Window*" } | Select-Object -First 1
    if (-not $proc) { Write-Error "No window matching '$Window'"; exit 1 }
    $h = $proc.MainWindowHandle
    $r = New-Object GemDpi+RECT
    if ([GemDpi]::GetWindowRect($h, [ref]$r)) {
        $X = $r.Left; $Y = $r.Top
        $W = $r.Right - $r.Left
        $H = $r.Bottom - $r.Top
    }
}

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ($X -lt 0) { $X = $bounds.X }
if ($Y -lt 0) { $Y = $bounds.Y }
if ($W -le 0) { $W = $bounds.Width }
if ($H -le 0) { $H = $bounds.Height }

# Clamp to virtual screen
if ($X -lt $bounds.X) { $X = $bounds.X }
if ($Y -lt $bounds.Y) { $Y = $bounds.Y }
if (($X + $W) -gt ($bounds.X + $bounds.Width)) { $W = $bounds.X + $bounds.Width - $X }
if (($Y + $H) -gt ($bounds.Y + $bounds.Height)) { $H = $bounds.Y + $bounds.Height - $Y }
if ($W -le 0 -or $H -le 0) { Write-Error "Invalid capture region"; exit 1 }

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$bmp = New-Object System.Drawing.Bitmap $W, $H
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size $W, $H), [System.Drawing.CopyPixelOperation]::SourceCopy)

if ($Gray) {
    $gray = New-Object System.Drawing.Imaging.ColorMatrix
    # simple luminance matrix
    $gray.Matrix00 = 0.299; $gray.Matrix01 = 0.299; $gray.Matrix02 = 0.299
    $gray.Matrix10 = 0.587; $gray.Matrix11 = 0.587; $gray.Matrix12 = 0.587
    $gray.Matrix20 = 0.114; $gray.Matrix21 = 0.114; $gray.Matrix22 = 0.114
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetColorMatrix($gray)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
    $gfx2 = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx2.DrawImage($bmp, $rect, 0, 0, $W, $H, [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $gfx2.Dispose()
}

# Downscale very large captures so they stay readable/cheap
$outBmp = $bmp
if ($W -gt 1920) {
    $scale = 1920.0 / $W
    $nw = 1920; $nh = [int]($H * $scale)
    $outBmp = New-Object System.Drawing.Bitmap $nw, $nh
    $g3 = [System.Drawing.Graphics]::FromImage($outBmp)
    $g3.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g3.DrawImage($bmp, 0, 0, $nw, $nh)
    $g3.Dispose()
}

$outBmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose(); $bmp.Dispose(); $outBmp.Dispose()

Write-Output "SAVED $Out ($W x $H at $X,$Y)"
