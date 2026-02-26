$ErrorActionPreference = "Stop"

# evolve_core: Self-evolution - build, test, deploy with watchdog rollback
# Sends PowerShell payload to execute_powershell (Windows)

if (-not $env:MOXXY_SOURCE_DIR) {
    Write-Output "Error: MOXXY_SOURCE_DIR is not set. The source directory could not be detected from the running binary."
    exit 1
}

$srcDir = $env:MOXXY_SOURCE_DIR -replace "'", "''"
$wdogContent = "Set-Location '$srcDir'`n" +
    "Start-Sleep -Seconds 2`n" +
    "Get-Process -Name moxxy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`n" +
    "Start-Sleep -Seconds 1`n" +
    "`$p = Start-Process -FilePath `".\target\release\moxxy.exe`" -ArgumentList `"web`" -WorkingDirectory (Get-Location) -PassThru -NoNewWindow -ErrorAction SilentlyContinue`n" +
    "if (-not `$p) { `$p = Start-Process -FilePath `".\target\release\moxxy`" -ArgumentList `"web`" -WorkingDirectory (Get-Location) -PassThru -NoNewWindow -ErrorAction SilentlyContinue }`n" +
    "Start-Sleep -Seconds 5`n" +
    "if (-not `$p -or `$p.HasExited) {`n" +
    "    Write-Output 'Watchdog: New process crashed! Rolling back...'`n" +
    "    Copy-Item target\release\moxxy.bak target\release\moxxy.exe -Force -ErrorAction SilentlyContinue`n" +
    "    Copy-Item target\release\moxxy.bak target\release\moxxy -Force -ErrorAction SilentlyContinue`n" +
    "    Start-Process -FilePath `".\target\release\moxxy.exe`" -ArgumentList `"web`" -WorkingDirectory (Get-Location) -NoNewWindow -ErrorAction SilentlyContinue`n" +
    "}"

$wdogEscaped = $wdogContent -replace "'", "''"
$payload = @"
Set-Location '$srcDir'
if (-not (Test-Path .)) { exit 1 }

Write-Output '[1/4] Running cargo check...'
`$checkOut = cargo check 2>&1
if (`$LASTEXITCODE -ne 0) {
    Write-Output 'Syntax Error during cargo check. Aborting.'
    Write-Output `$checkOut
    exit 1
}

Write-Output '[2/4] Running cargo test...'
`$testOut = cargo test 2>&1
if (`$LASTEXITCODE -ne 0) {
    Write-Output 'Tests failed. Aborting.'
    Write-Output `$testOut
    exit 1
}

Write-Output '[3/4] Running cargo build --release...'
`$buildOut = cargo build --release 2>&1
if (`$LASTEXITCODE -ne 0) {
    Write-Output 'Compilation failed. Aborting.'
    Write-Output `$buildOut
    exit 1
}

Write-Output '[4/4] Compilation successful. Preparing Watchdog Rollback...'
Copy-Item target\release\moxxy.exe target\release\moxxy.bak -ErrorAction SilentlyContinue
Copy-Item target\release\moxxy target\release\moxxy.bak -ErrorAction SilentlyContinue

`$wdogContent = '$wdogEscaped'
Set-Content -Path target\release\watchdog.ps1 -Value `$wdogContent
Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File target\release\watchdog.ps1" -WorkingDirectory (Get-Location) -WindowStyle Hidden
Write-Output 'Watchdog deployed. Restart sequence initiating... Connection will drop shortly.'
"@

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$body = @{ command = $payload } | ConvertTo-Json
$headers = @{ "Content-Type" = "application/json" }
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

Invoke-RestMethod -Uri "$apiBase/host/execute_powershell" -Method Post -Headers $headers -Body $body
