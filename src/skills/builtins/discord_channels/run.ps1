$ErrorActionPreference = "Stop"

if (-not $env:AGENT_NAME) {
    Write-Output "AGENT_NAME is required"
    exit 1
}

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$headers = @{}
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

try {
    $resp = Invoke-RestMethod -Uri "$apiBase/agents/$env:AGENT_NAME/channels/discord/list-channels" -Headers $headers
    Write-Output ($resp | ConvertTo-Json -Depth 10)
} catch {
    Write-Output "Error: $($_.Exception.Message)"
    exit 1
}
