$ErrorActionPreference = "Stop"

$headers = @{ "Content-Type" = "text/plain" }
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

$agentName = $args[0]
$prompt = $args[1]

if (-not $agentName -or -not $prompt) {
    Write-Output "Error: Must provide both Target Agent Name and Prompt."
    exit 1
}

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }

try {
    $resp = Invoke-RestMethod -Uri "$apiBase/agents/$agentName/delegate" `
        -Method Post -Body $prompt -Headers $headers
    if ($resp.success) {
        Write-Output $resp.response
    } else {
        Write-Output "Delegation Failed: $($resp.error ?? 'unknown error')"
        exit 1
    }
} catch {
    Write-Output "Delegation Failed: $($_.Exception.Message)"
    exit 1
}
