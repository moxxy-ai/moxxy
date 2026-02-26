$ErrorActionPreference = "Stop"

$headers = @{}
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

$name = $args[0]
if (-not $name) {
    Write-Output "Usage: remove_schedule <job_name|--all>"
    Write-Output "Error: Missing required argument."
    exit 1
}

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }

$uri = if ($name -eq "--all") {
    "$apiBase/agents/$env:AGENT_NAME/schedules"
} else {
    $encoded = [System.Net.WebUtility]::UrlEncode($name)
    "$apiBase/agents/$env:AGENT_NAME/schedules/$encoded"
}

try {
    $resp = Invoke-RestMethod -Uri $uri -Method Delete -Headers $headers
    if ($resp.success) {
        Write-Output "Successfully removed schedule: $name"
    } else {
        Write-Output "Failed to remove schedule. Server responded:"
        Write-Output ($resp | ConvertTo-Json -Compress)
        exit 1
    }
} catch {
    Write-Output "Failed to remove schedule: $($_.Exception.Message)"
    exit 1
}
