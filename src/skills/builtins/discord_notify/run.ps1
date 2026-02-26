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

if ($args.Count -lt 1) {
    Write-Output "Usage: discord_notify '<message>'"
    Write-Output "   or: discord_notify '<channel_id>' '<message>'"
    exit 1
}

# Two-arg form: channel_id + message. One-arg form: message only
$channelId = $null
$message = $null
if ($args.Count -ge 2 -and $args[0] -match '^\d+$') {
    $channelId = $args[0]
    $message = ($args[1..($args.Length-1)] -join " ")
} else {
    $message = $args -join " "
}

$body = "message=" + [System.Net.WebUtility]::UrlEncode($message)
if ($channelId) {
    $body += "&channel_id=" + [System.Net.WebUtility]::UrlEncode($channelId)
}

try {
    $resp = Invoke-RestMethod -Uri "$apiBase/agents/$env:AGENT_NAME/channels/discord/send" `
        -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -Headers $headers
    if ($resp.success) {
        Write-Output ($resp.message ?? "Discord message sent.")
    } else {
        Write-Output "Error: $($resp.error ?? 'failed to send Discord message')"
        exit 1
    }
} catch {
    Write-Output "Error: $($_.Exception.Message)"
    exit 1
}
