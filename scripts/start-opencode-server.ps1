# E:\Gematron\scripts\start-opencode-server.ps1
# Ensures OpenCode HTTP API Server is running on port 4096 with known credentials

$Port = 4096
$CliPath = "C:\Users\tnkav\AppData\Local\Programs\ai.opencode.desktop\resources\opencode-cli.exe"
$PasswordFile = "E:\Gematron\logs\opencode-server-password.txt"

# Check if already listening on port 4096
$conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 -and $_.State -ne 'Closed' } | Select-Object -First 1
if ($conn -and $conn.OwningProcess -ne 0) {
    Write-Host "[OpenCode Server] Already running on port $Port (PID: $($conn.OwningProcess))" -ForegroundColor Green
    if (Test-Path $PasswordFile) {
        $pw = Get-Content $PasswordFile -Raw
        Write-Host "[OpenCode Server] Active password loaded from $PasswordFile" -ForegroundColor Cyan
    }
    exit 0
}

Write-Host "[OpenCode Server] Starting daemon on port $Port..." -ForegroundColor Yellow

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $CliPath
$psi.Arguments = "serve --port $Port"
$psi.WorkingDirectory = "E:\Gematron"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)

# Read password from stdout
$foundPw = $false
$timeout = 10
$sw = [System.Diagnostics.Stopwatch]::StartNew()

while ($sw.Elapsed.TotalSeconds -lt $timeout -and -not $foundPw) {
    if (-not $proc.StandardOutput.EndOfStream) {
        $line = $proc.StandardOutput.ReadLine()
        if ($line -match "server password\s+(.+)") {
            $pw = $matches[1].Trim()
            Set-Content -Path $PasswordFile -Value $pw -Encoding utf8
            Write-Host "[OpenCode Server] Server listening on port $Port" -ForegroundColor Green
            Write-Host "[OpenCode Server] Saved credentials to $PasswordFile" -ForegroundColor Cyan
            $foundPw = $true
            break
        }
    }
    Start-Sleep -Milliseconds 200
}

if (-not $foundPw) {
    Write-Host "[OpenCode Server] Warning: Server started (PID: $($proc.Id)) but password was not detected in timeout." -ForegroundColor Yellow
}
