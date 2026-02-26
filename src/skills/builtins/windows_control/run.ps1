# Windows-only skill: control the host Windows machine via PowerShell
if ($env:OS -ne "Windows_NT") {
    Write-Output '{"success":false,"error":"This skill requires Windows. It is not available on your current operating system."}'
    exit 0
}

if (-not $args[0]) {
    Write-Output "Usage: windows_control '<PowerShell Code>'"
    exit 1
}

$script = $args[0]
$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$headers = @{
    "Content-Type" = "application/json"
}
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

$body = @{ script = $script } | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "$apiBase/host/execute_powershell" -Method Post -Body $body -Headers $headers
    if ($resp.success) {
        Write-Output $resp.output
    } else {
        Write-Output ($resp | ConvertTo-Json -Compress)
        exit 1
    }
} catch {
    Write-Output "{`"success`":false,`"error`":`"$($_.Exception.Message)`"}"
    exit 1
}
