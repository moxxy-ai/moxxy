$ErrorActionPreference = "Stop"

if (-not $env:AGENT_NAME) {
    $env:AGENT_NAME = "default"
}

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$apiUrl = "$apiBase/agents/$($env:AGENT_NAME)/orchestrate"

$headers = @{}
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

$resource = $args[0]
$action = $args[1]
$arg1 = if ($args.Length -gt 2) { $args[2] } else { $null }
$arg2 = if ($args.Length -gt 3) { $args[3] } else { $null }

function Invoke-OrchestratorRequest {
    param(
        [string]$Method,
        [string]$Url,
        [string]$Body
    )

    if ($Body) {
        Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -ContentType "application/json" -Body $Body | ConvertTo-Json -Depth 20
    } else {
        Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers | ConvertTo-Json -Depth 20
    }
}

switch ("$resource`:$action") {
    "config:get" { Invoke-OrchestratorRequest -Method "GET" -Url "$apiUrl/config"; break }
    "config:set" {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing JSON payload"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "POST" -Url "$apiUrl/config" -Body $arg1
        break
    }
    "templates:list" { Invoke-OrchestratorRequest -Method "GET" -Url "$apiUrl/templates"; break }
    "templates:get" {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing template_id"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "GET" -Url "$apiUrl/templates/$arg1"
        break
    }
    { $_ -in @("templates:upsert", "templates:create") } {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing JSON payload"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "POST" -Url "$apiUrl/templates" -Body $arg1
        break
    }
    { $_ -in @("templates:patch", "templates:update") } {
        if (-not $arg1 -or -not $arg2) { Write-Output '{"success":false,"error":"Missing template_id or JSON payload"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "PATCH" -Url "$apiUrl/templates/$arg1" -Body $arg2
        break
    }
    { $_ -in @("templates:delete", "templates:remove") } {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing template_id"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "DELETE" -Url "$apiUrl/templates/$arg1"
        break
    }
    "jobs:start" {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing JSON payload"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "POST" -Url "$apiUrl/jobs" -Body $arg1
        break
    }
    "jobs:run" {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing JSON payload"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "POST" -Url "$apiUrl/jobs/run" -Body $arg1
        break
    }
    { $_ -in @("jobs:get", "jobs:status") } {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing job_id"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "GET" -Url "$apiUrl/jobs/$arg1"
        break
    }
    "jobs:workers" {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing job_id"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "GET" -Url "$apiUrl/jobs/$arg1/workers"
        break
    }
    "jobs:events" {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing job_id"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "GET" -Url "$apiUrl/jobs/$arg1/events"
        break
    }
    "jobs:stream" {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing job_id"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "GET" -Url "$apiUrl/jobs/$arg1/stream"
        break
    }
    "jobs:cancel" {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing job_id"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "POST" -Url "$apiUrl/jobs/$arg1/cancel"
        break
    }
    { $_ -in @("jobs:approve-merge", "jobs:approve") } {
        if (-not $arg1) { Write-Output '{"success":false,"error":"Missing job_id"}'; exit 1 }
        Invoke-OrchestratorRequest -Method "POST" -Url "$apiUrl/jobs/$arg1/actions/approve-merge"
        break
    }
    default {
        Write-Output '{"success":false,"error":"Unknown action. Use config/templates/jobs commands."}'
        exit 1
    }
}
