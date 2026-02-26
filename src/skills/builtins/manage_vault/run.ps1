$ErrorActionPreference = "Stop"

$agentName = if ($env:AGENT_NAME) { $env:AGENT_NAME } else { "default" }
$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$apiUrl = "$apiBase/agents/$agentName/vault"

$headers = @{}
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

$action = $args[0]
$key = $args[1]
$value = $args[2]

switch ($action) {
    "list" {
        Invoke-RestMethod -Uri $apiUrl -Headers $headers
    }
    "get" {
        if (-not $key) {
            Write-Output '{"success":false,"error":"Missing key name for get action"}'
            exit 1
        }
        Invoke-RestMethod -Uri "$apiUrl/$key" -Headers $headers
    }
    "set" {
        if (-not $key -or -not $value) {
            Write-Output '{"success":false,"error":"Missing key or value for set action"}'
            exit 1
        }
        $body = @{ key = $key; value = $value } | ConvertTo-Json
        $headers["Content-Type"] = "application/json"
        Invoke-RestMethod -Uri $apiUrl -Method Post -Body $body -Headers $headers
    }
    "remove" {
        if (-not $key) {
            Write-Output '{"success":false,"error":"Missing key name for remove action"}'
            exit 1
        }
        Invoke-RestMethod -Uri "$apiUrl/$key" -Method Delete -Headers $headers
    }
    default {
        Write-Output "{`"success`":false,`"error`":`"Unknown action: $action. Use list, get, set, or remove.`"}"
        exit 1
    }
}
