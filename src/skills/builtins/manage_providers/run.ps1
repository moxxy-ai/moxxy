$ErrorActionPreference = "Stop"

$agentName = if ($env:AGENT_NAME) { $env:AGENT_NAME } else { "default" }
$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$headers = @{}
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

$action = $args[0]

switch ($action) {
    "list" {
        Invoke-RestMethod -Uri "$apiBase/providers" -Headers $headers | ConvertTo-Json -Depth 10
    }
    "list_custom" {
        Invoke-RestMethod -Uri "$apiBase/providers/custom" -Headers $headers | ConvertTo-Json -Depth 10
    }
    "add" {
        $provId = $args[1]
        $provName = $args[2]
        $baseUrl = $args[3]
        $apiFormat = if ($args[4]) { $args[4] } else { "openai" }
        $vaultKey = if ($args[5]) { $args[5] } else { "${provId}_api_key" }
        $defaultModel = $args[6]
        $modelsJson = if ($args[7]) { $args[7] } else { "[]" }

        if (-not $provId -or -not $provName -or -not $baseUrl) {
            Write-Output '{"success":false,"error":"Usage: manage_providers add <id> <name> <base_url> [api_format] [vault_key] [default_model] [models_json]"}'
            exit 1
        }

        $body = @{
            id = $provId
            name = $provName
            api_format = $apiFormat
            base_url = $baseUrl
            auth = @{ type = "bearer"; vault_key = $vaultKey }
            default_model = $defaultModel
            models = ($modelsJson | ConvertFrom-Json)
            extra_headers = @{}
            custom = $true
        } | ConvertTo-Json -Depth 5

        $headers["Content-Type"] = "application/json"
        Invoke-RestMethod -Uri "$apiBase/providers/custom" -Method Post -Body $body -Headers $headers
    }
    "remove" {
        $provId = $args[1]
        if (-not $provId) {
            Write-Output '{"success":false,"error":"Usage: manage_providers remove <provider_id>"}'
            exit 1
        }
        Invoke-RestMethod -Uri "$apiBase/providers/custom/$provId" -Method Delete -Headers $headers
    }
    "switch" {
        $provider = $args[1]
        $model = $args[2]
        if (-not $provider -or -not $model) {
            Write-Output '{"success":false,"error":"Usage: manage_providers switch <provider_id> <model_id>"}'
            exit 1
        }
        $body = @{ provider = $provider; model = $model } | ConvertTo-Json
        $headers["Content-Type"] = "application/json"
        Invoke-RestMethod -Uri "$apiBase/agents/$agentName/llm" -Method Post -Body $body -Headers $headers
    }
    default {
        Write-Output "{`"success`":false,`"error`":`"Unknown action: $action. Use list, list_custom, add, remove, or switch.`"}"
        exit 1
    }
}
