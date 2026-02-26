$ErrorActionPreference = "Stop"

# Built-in Skill: webhook - Unified webhook management
# Actions: register, remove, enable, disable, update, list

if (-not $env:AGENT_NAME) {
    Write-Output "AGENT_NAME is required"
    exit 1
}

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$headers = @{ "Content-Type" = "application/json" }
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

function Esc-Json($s) {
    if (-not $s) { return "" }
    ($s -replace '\\', '\\\\' -replace '"', '\"').Replace("`n", "\n").Replace("`r", "")
}

function Get-JsonValue($json, $key, $default = "") {
    try {
        $o = $json | ConvertFrom-Json
        $v = $o.$key
        if ($null -eq $v) { return $default }
        return [string]$v
    } catch {
        return $default
    }
}

function UrlEncode($s) {
    [System.Uri]::EscapeDataString($s)
}

$action = $args[0]
if (-not $action) {
    Write-Output "Usage: webhook <action> [arguments...]"
    Write-Output "Actions: register, remove, enable, disable, update, list"
    Write-Output "Error: Missing action."
    exit 1
}

$uri = ""
$method = "Get"
$body = $null

switch ($action) {
    "register" {
        $name = $args[1]
        $source = $args[2]
        $promptTemplate = $args[3]
        $secret = $args[4]
        if (-not $name -or -not $source -or -not $promptTemplate) {
            Write-Output "Usage: webhook register <name> <source_slug> <prompt_template> [secret]"
            Write-Output "Error: name, source_slug, and prompt_template are required."
            exit 1
        }
        $uri = "$apiBase/agents/$($env:AGENT_NAME)/webhooks"
        $method = "Post"
        $body = @{
            name = $name
            source = $source
            prompt_template = $promptTemplate
            secret = if ($secret) { $secret } else { "" }
        } | ConvertTo-Json
    }
    "remove" {
        $name = $args[1]
        if (-not $name) {
            Write-Output "Usage: webhook remove <webhook_name>"
            Write-Output "Error: webhook name is required."
            exit 1
        }
        $encoded = UrlEncode $name
        $uri = "$apiBase/agents/$($env:AGENT_NAME)/webhooks/$encoded"
        $method = "Delete"
    }
    "enable" {
        $name = $args[1]
        if (-not $name) {
            Write-Output "Usage: webhook enable <webhook_name>"
            Write-Output "Error: webhook name is required."
            exit 1
        }
        $encoded = UrlEncode $name
        $uri = "$apiBase/agents/$($env:AGENT_NAME)/webhooks/$encoded"
        $method = "Patch"
        $body = '{"active":true}'
    }
    "disable" {
        $name = $args[1]
        if (-not $name) {
            Write-Output "Usage: webhook disable <webhook_name>"
            Write-Output "Error: webhook name is required."
            exit 1
        }
        $encoded = UrlEncode $name
        $uri = "$apiBase/agents/$($env:AGENT_NAME)/webhooks/$encoded"
        $method = "Patch"
        $body = '{"active":false}'
    }
    "update" {
        $name = $args[1]
        $source = $args[2]
        $promptTemplate = $args[3]
        $secret = $args[4]
        if (-not $name -or -not $source -or -not $promptTemplate) {
            Write-Output "Usage: webhook update <name> <source_slug> <new_prompt_template> [new_secret]"
            Write-Output "Error: name, source_slug, and prompt_template are required."
            exit 1
        }
        $uri = "$apiBase/agents/$($env:AGENT_NAME)/webhooks"
        $method = "Post"
        $body = @{
            name = $name
            source = $source
            prompt_template = $promptTemplate
            secret = if ($secret) { $secret } else { "" }
        } | ConvertTo-Json
    }
    "list" {
        $uri = "$apiBase/agents/$($env:AGENT_NAME)/webhooks"
        $method = "Get"
    }
    default {
        Write-Output "Unknown action: $action"
        Write-Output "Valid actions: register, remove, enable, disable, update, list"
        exit 1
    }
}

try {
    $params = @{
        Uri = $uri
        Method = $method
        Headers = $headers
    }
    if ($body) { $params.Body = $body }

    $response = Invoke-WebRequest @params -UseBasicParsing
    $statusCode = [int]$response.StatusCode
    $bodyText = $response.Content
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if (-not $statusCode) { $statusCode = 500 }
    $bodyText = $_.ErrorDetails.Message
    if (-not $bodyText) { $bodyText = $_.Exception.Message }
}

if ($action -eq "list") {
    if ($statusCode -eq 200) {
        try {
            $list = $bodyText | ConvertFrom-Json
            $items = $list.webhooks
            if ($null -eq $items) { $items = @() }
            if ($items -isnot [array]) { $items = @($items) }
            if ($items.Count -eq 0) {
                Write-Output "No webhooks registered."
            } else {
                foreach ($wh in $items) {
                    $n = $wh.name
                    $src = $wh.source
                    $act = $wh.active
                    $label = if ($act) { "[ACTIVE]" } else { "[INACTIVE]" }
                    Write-Output "$label $n -> /api/webhooks/$($env:AGENT_NAME)/$src"
                }
            }
        } catch {
            Write-Output $bodyText
        }
    } else {
        Write-Output "HTTP Error $statusCode"
        Write-Output $bodyText
    }
    exit 0
}

if ($statusCode -eq 200) {
    if ($bodyText -match '"success"\s*:\s*true') {
        Write-Output "Successfully performed '$action' on webhook."
        try {
            $o = $bodyText | ConvertFrom-Json
            if ($o.webhook_url) { Write-Output "Webhook URL: $($o.webhook_url)" }
            if ($o.message) { Write-Output $o.message }
        } catch {}
    } else {
        Write-Output "Failed to $action webhook. Server responded:"
        Write-Output $bodyText
        exit 1
    }
} else {
    Write-Output "HTTP Error $statusCode when communicating with API."
    Write-Output "Response: $bodyText"
    exit 1
}
