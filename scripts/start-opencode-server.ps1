# E:\Gematron\scripts\start-opencode-server.ps1
# Ensures OpenCode HTTP API Server is running on port 4096 with known credentials

$Port = 4096
$PasswordFile = "E:\Gematron\logs\opencode-server-password.txt"

# --- Resolve the OpenCode CLI executable -------------------------------
# The CLI can live in several places depending on how OpenCode was
# installed (desktop app, npm global, scoop, custom). Probe the known
# locations instead of hardcoding a single path.
function Resolve-OpenCodeCli {
    $candidates = @()

    if ($env:OPENCODE_CLI) { $candidates += $env:OPENCODE_CLI }

    # Desktop app bundle
    $candidates += Join-Path $env:LOCALAPPDATA 'Programs\ai.opencode.desktop\resources\opencode-cli.exe'

    # npm global shim -> real executable inside the package
    $cmd = Get-Command 'opencode.cmd' -ErrorAction SilentlyContinue
    if ($cmd) {
        $candidates += Join-Path (Split-Path $cmd.Source -Parent) 'node_modules\@opencode\cli\bin\opencode.exe'
    }

    # Explicit npm prefix used on this machine
    $candidates += 'E:\npm\node_modules\@opencode\cli\bin\opencode.exe'

    # Any opencode.exe already on PATH
    $onPath = Get-Command 'opencode.exe' -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += $onPath.Source }

    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        try { $full = [System.IO.Path]::GetFullPath($candidate) } catch { continue }
        if (Test-Path -LiteralPath $full -PathType Leaf) { return $full }
    }

    return $null
}

# Check if already listening on port 4096
$conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -gt 0 -and $_.State -ne 'Closed' } |
    Select-Object -First 1
if ($conn -and $conn.OwningProcess -ne 0) {
    Write-Host "[OpenCode Server] Already running on port $Port (PID: $($conn.OwningProcess))" -ForegroundColor Green
    if (Test-Path $PasswordFile) {
        Write-Host "[OpenCode Server] Active password loaded from $PasswordFile" -ForegroundColor Cyan
    }
    exit 0
}

$CliPath = Resolve-OpenCodeCli
if (-not $CliPath) {
    Write-Host "[OpenCode Server] ERROR: Could not locate the OpenCode CLI executable." -ForegroundColor Red
    Write-Host "  Checked:" -ForegroundColor Red
    Write-Host "    - \$env:OPENCODE_CLI" -ForegroundColor Red
    Write-Host "    - $env:LOCALAPPDATA\Programs\ai.opencode.desktop\resources\opencode-cli.exe" -ForegroundColor Red
    Write-Host "    - npm global shim (opencode.cmd)" -ForegroundColor Red
    Write-Host "    - E:\npm\node_modules\@opencode\cli\bin\opencode.exe" -ForegroundColor Red
    Write-Host "  Set OPENCODE_CLI to the full path of opencode.exe to override." -ForegroundColor Red
    exit 1
}

Write-Host "[OpenCode Server] Starting daemon on port $Port..." -ForegroundColor Yellow
Write-Host "[OpenCode Server] Using CLI: $CliPath" -ForegroundColor DarkGray

if (-not (Test-Path -LiteralPath 'E:\Gematron')) {
    Write-Host "[OpenCode Server] ERROR: Working directory E:\Gematron does not exist." -ForegroundColor Red
    exit 1
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $CliPath
$psi.Arguments = "serve --port $Port"
$psi.WorkingDirectory = "E:\Gematron"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

try {
    $proc = [System.Diagnostics.Process]::Start($psi)
} catch {
    Write-Host "[OpenCode Server] ERROR: Failed to start '$CliPath'." -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Read password from stdout (non-blocking, so the timeout actually works)
$foundPw = $false
$timeout = 10
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$readTask = $proc.StandardOutput.ReadLineAsync()

while ($sw.Elapsed.TotalSeconds -lt $timeout -and -not $foundPw) {
    if ($proc.HasExited) { break }

    if ($readTask.Wait(200)) {
        $line = $readTask.Result
        if ($null -eq $line) { break }  # stdout closed

        if ($line -match "server password\s+(.+)") {
            $pw = $matches[1].Trim()
            New-Item -ItemType Directory -Path (Split-Path $PasswordFile -Parent) -Force | Out-Null
            Set-Content -Path $PasswordFile -Value $pw -Encoding ascii
            Write-Host "[OpenCode Server] Server listening on port $Port" -ForegroundColor Green
            Write-Host "[OpenCode Server] Saved credentials to $PasswordFile" -ForegroundColor Cyan
            $foundPw = $true
            break
        }

        $readTask = $proc.StandardOutput.ReadLineAsync()
    }
}

if ($proc.HasExited -and -not $foundPw) {
    $stderr = $proc.StandardError.ReadToEnd()
    Write-Host "[OpenCode Server] ERROR: Server exited with code $($proc.ExitCode)." -ForegroundColor Red
    if ($stderr) { Write-Host $stderr -ForegroundColor Red }
    exit 1
}

if (-not $foundPw) {
    Write-Host "[OpenCode Server] Warning: Server started (PID: $($proc.Id)) but password was not detected in timeout." -ForegroundColor Yellow
} else {
    Write-Host "[OpenCode Server] PID: $($proc.Id)" -ForegroundColor DarkGray
}

exit 0
