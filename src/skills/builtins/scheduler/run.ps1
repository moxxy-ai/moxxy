$ErrorActionPreference = "Stop"

$headers = @{ "Content-Type" = "application/json" }
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

$name = $args[0]
$cron = $args[1]
$prompt = $args[2]

if (-not $name -or -not $cron -or -not $prompt) {
    Write-Output "Usage: scheduler <name> <cron_expression> <prompt_string>"
    Write-Output "Error: Missing required arguments."
    exit 1
}

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$body = @{ name = $name; cron = $cron; prompt = $prompt } | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "$apiBase/agents/$env:AGENT_NAME/schedules" `
        -Method Post -Body $body -Headers $headers
    if ($resp.success) {
        Write-Output "Successfully scheduled job: $name"
    } else {
        Write-Output "Failed to schedule job. Server responded:"
        Write-Output ($resp | ConvertTo-Json -Compress)
        exit 1
    }
} catch {
    Write-Output "Failed to schedule job: $($_.Exception.Message)"
    exit 1
}
