$ErrorActionPreference = "Stop"

$apiUrl = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$agentName = if ($env:MOXXY_AGENT_NAME) { $env:MOXXY_AGENT_NAME } else { "default" }
$headers = @{ "Content-Type" = "application/json" }
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

$action = $args[0]

switch ($action) {
    "list" {
        Invoke-RestMethod -Uri "$apiUrl/agents/$agentName/mcp" -Headers $headers | ConvertTo-Json -Depth 10
    }
    "add" {
        $serverName = $args[1]
        $command = $args[2]
        $argsStr = $args[3]
        $envJson = if ($args[4]) { $args[4] } else { "{}" }

        if (-not $serverName -or -not $command) {
            Write-Output "Error: server_name and command are required."
            exit 1
        }

        $body = @{
            name = $serverName
            command = $command
            args = $argsStr
            env = $envJson
        } | ConvertTo-Json

        Invoke-RestMethod -Uri "$apiUrl/agents/$agentName/mcp" -Method Post -Body $body -Headers $headers
    }
    "add-json" {
        $jsonConfig = $args[1]
        if (-not $jsonConfig) {
            Write-Output "Error: JSON config is required."
            Write-Output "Expected format: {\"mcpServers\":{\"name\":{\"command\":\"...\",\"args\":[...],\"env\":{...}}}}"
            exit 1
        }
        $genericNames = @("default", "mcp", "server", "default_server", "unknown")
        function Derive-Name {
            param($name, $spec)
            if ($genericNames -notcontains $name.ToLower()) { return $name }
            $argsList = $spec.args
            if ($argsList -is [string]) { $argsList = $argsList -split '\s+' }
            $arr = @($argsList)
            if (-not $arr) { return "mcp_tool" }
            $n = $arr.Count
            $start = [Math]::Max(0, $n - 5)
            for ($i = $n - 1; $i -ge $start; $i--) {
                $a = "$($arr[$i])".Trim()
                if (-not $a -or $a.StartsWith("-") -or $a.StartsWith("/")) { continue }
                $part = ($a -split '[/@]')[-1]
                if ($part -match '^([a-zA-Z0-9]+)(?:[-_]?(?:mcp|server))?') {
                    $d = $Matches[1].ToLower()
                    if ($d -and $genericNames -notcontains $d) { return $d }
                }
                foreach ($seg in ($part -replace '_', '-' -split '-')) {
                    if ($seg -match '^[a-zA-Z][a-zA-Z0-9]*$' -and $genericNames -notcontains $seg.ToLower()) {
                        return $seg.ToLower()
                    }
                }
            }
            return "mcp_tool"
        }
        $config = $jsonConfig | ConvertFrom-Json
        $serverObj = if ($config.PSObject.Properties.Name -contains 'mcpServers') { $config.mcpServers } else { $config }
        $servers = $serverObj.PSObject.Properties
        $added = 0
        foreach ($prop in $servers) {
            $name = $prop.Name
            $spec = $prop.Value
            $cmd = $spec.command
            if (-not $cmd) {
                Write-Output "Skipping `"$name`": no command specified."
                continue
            }
            $finalName = Derive-Name $name $spec
            if ($finalName -ne $name) {
                Write-Output "Renaming generic `"$name`" to `"$finalName`" (derived from spec)"
            }
            $argsList = $spec.args
            $argsStr = if ($null -eq $argsList) { "" } elseif ($argsList -is [string]) { $argsList } else { (@($argsList) | ForEach-Object { $_ }) -join " " }
            $envObj = if ($spec.env) { $spec.env } else { @{} }
            $body = @{
                name = $finalName
                command = $cmd
                args = $argsStr
                env = ($envObj | ConvertTo-Json -Compress)
            } | ConvertTo-Json
            Write-Output "Adding MCP server: $finalName"
            try {
                $r = Invoke-RestMethod -Uri "$apiUrl/agents/$agentName/mcp" -Method Post -Body $body -Headers $headers
                Write-Output ($r | ConvertTo-Json -Compress)
            } catch {
                Write-Output "Error adding $name : $_"
            }
            $added++
        }
        Write-Output "Added $added MCP server(s). Please restart the gateway (moxxy gateway restart) to initialize them."
    }
    "remove" {
        $serverName = $args[1]
        if (-not $serverName) {
            Write-Output "Error: server_name is required."
            exit 1
        }
        Invoke-RestMethod -Uri "$apiUrl/agents/$agentName/mcp/$serverName" -Method Delete -Headers $headers
    }
    default {
        Write-Output "Usage:"
        Write-Output "  mcp list"
        Write-Output "  mcp add <name> <command> <args> <env_json>"
        Write-Output "  mcp add-json '<mcpServers JSON config>'"
        Write-Output "  mcp remove <name>"
        exit 1
    }
}
