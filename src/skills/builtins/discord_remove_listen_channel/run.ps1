$ErrorActionPreference = "Stop"

if (-not $env:AGENT_NAME) {
    Write-Output "AGENT_NAME is required"
    exit 1
}

$channelId = $args[0]
if (-not $channelId) {
    Write-Output "Usage: discord_remove_listen_channel '<channel_id>'"
    Write-Output "Use discord_channels to find channel IDs."
    exit 1
}

if ($channelId -notmatch '^\d+$') {
    Write-Output "Error: channel_id must be a numeric Discord snowflake."
    exit 1
}

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$headers = @{ "Content-Type" = "application/json" }
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}
$body = @{ channel_id = $channelId } | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "$apiBase/agents/$env:AGENT_NAME/channels/discord/listen-channels/remove" `
        -Method Post -Body $body -Headers $headers
    if ($resp.success) {
        Write-Output ($resp.message ?? "Channel removed from listen list.")
    } else {
        Write-Output "Error: $($resp.error ?? 'failed to remove channel')"
        exit 1
    }
} catch {
    Write-Output "Error: $($_.Exception.Message)"
    exit 1
}
