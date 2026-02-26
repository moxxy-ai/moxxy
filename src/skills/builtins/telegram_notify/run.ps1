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
    Write-Output "Usage: telegram_notify '<message>'"
    exit 1
}

$message = $args -join " "

try {
    $body = "message=" + [System.Net.WebUtility]::UrlEncode($message)
    $resp = Invoke-RestMethod -Uri "$apiBase/agents/$env:AGENT_NAME/channels/telegram/send" `
        -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -Headers $headers
    if ($resp.success) {
        Write-Output ($resp.message ?? "Telegram message sent.")
    } else {
        Write-Output "Error: $($resp.error ?? 'failed to send Telegram message')"
        exit 1
    }
} catch {
    Write-Output "Error: $($_.Exception.Message)"
    exit 1
}
