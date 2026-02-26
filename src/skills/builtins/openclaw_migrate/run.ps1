$ErrorActionPreference = "Stop"

# openclaw_migrate: Migrate OpenClaw configuration to Moxxy
# Subcommands: check, list, migrate <agent>, persona <agent>, skills <agent>

$homeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
$openclawDir = Join-Path $homeDir ".openclaw" | Join-Path -ChildPath "workspace"
$openclawRoot = Join-Path $homeDir ".openclaw"

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
if ($env:AGENT_HOME) {
    $moxxyDir = Split-Path $env:AGENT_HOME -Parent
} else {
    $moxxyDir = Join-Path $env:USERPROFILE ".moxxy\agents"
    if (-not $env:USERPROFILE) { $moxxyDir = Join-Path $env:HOME ".moxxy/agents" }
}

$headers = @{ "Content-Type" = "application/json" }
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

function Transform-Persona {
    param([string]$content)
    $lines = $content -split "`n"
    $output = @()
    $skip = $false
    $skipLevel = 0
    foreach ($line in $lines) {
        $headingLevel = 0
        if ($line -match '^(#+)') { $headingLevel = $Matches[1].Length }
        if ($headingLevel -gt 0) {
            if ($skip) {
                if ($headingLevel -le $skipLevel) { $skip = $false }
                else { continue }
            }
            if (-not $skip) {
                $norm = $line -replace '^#+\s*', '' -replace '[^\x20-\x7E]', '' -replace '[^a-zA-Z0-9 .()-]', '' -replace '\s+', ' ' -replace '^\s+|\s+$', ''
                $norm = $norm.ToLower()
                $shouldSkip = $false
                if ($norm.StartsWith("first run")) { $shouldSkip = $true }
                elseif ($norm.StartsWith("every session")) { $shouldSkip = $true }
                elseif ($norm -eq "memory") { $shouldSkip = $true }
                elseif ($norm -match "memory\.md") { $shouldSkip = $true }
                elseif ($norm -match "write it down") { $shouldSkip = $true }
                elseif ($norm -match "heartbeats") { $shouldSkip = $true }
                elseif ($norm -match "heartbeat vs cron") { $shouldSkip = $true }
                elseif ($norm -match "memory maintenance") { $shouldSkip = $true }
                elseif ($norm -match "know when to speak") { $shouldSkip = $true }
                if ($shouldSkip) { $skip = $true; $skipLevel = $headingLevel; continue }
            }
        }
        if (-not $skip) {
            $out = $line -replace ' \(from SOUL\.md\)', '' -replace ' \(from AGENTS\.md\)', '' -replace '^_Migrated from OpenClaw_$', ''
            $output += $out
        }
    }
    $output -join "`n"
}

function Duration-ToCron($dur) {
    if (-not $dur -or $dur -match '^0[mh]$') { return "" }
    if ($dur -match '^(\d+)m$') {
        $n = [int]$Matches[1]
        if ($n -gt 0) { return "0 */$n * * * *" }
    }
    if ($dur -match '^(\d+)h$') {
        $n = [int]$Matches[1]
        if ($n -gt 0) { return "0 0 */$n * * *" }
    }
    return ""
}

function Api-Post($uri, $body) {
    try {
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body | Out-Null
    } catch {}
}

$subcmd = $args[0]
$target = $args[1]

switch ($subcmd) {
    "check" {
        if (Test-Path $openclawDir -PathType Container) {
            Write-Output "OpenClaw detected at ~/.openclaw/workspace"
            Write-Output ""
            $soul = Join-Path $openclawDir "SOUL.md"
            $agents = Join-Path $openclawDir "AGENTS.md"
            $mem = Join-Path $openclawDir "MEMORY.md"
            Write-Output $(if (Test-Path $soul) { "- SOUL.md: found" } else { "- SOUL.md: not found" })
            Write-Output $(if (Test-Path $agents) { "- AGENTS.md: found" } else { "- AGENTS.md: not found" })
            Write-Output $(if (Test-Path $mem) { "- MEMORY.md: found" } else { "- MEMORY.md: not found" })
            $skillsPath = Join-Path $openclawDir "skills"
            $skillCount = 0
            if (Test-Path $skillsPath) {
                $skillCount = (Get-ChildItem $skillsPath -Directory | ForEach-Object {
                    if (Test-Path (Join-Path $_.FullName "SKILL.md")) { 1 }
                } | Measure-Object -Sum).Sum
            }
            Write-Output "- Skills: $skillCount found"
            $memDir = Join-Path $openclawDir "memory"
            if (Test-Path $memDir) {
                $memCount = (Get-ChildItem $memDir -Filter "*.md" -File).Count
                Write-Output "- Daily memories: $memCount found"
            }
        } else {
            Write-Output "OpenClaw installation not found at ~/.openclaw/workspace"
        }
    }
    "list" {
        if (-not (Test-Path $openclawDir -PathType Container)) {
            Write-Output "OpenClaw installation not found"
            exit 1
        }
        Write-Output "=== Personas ==="
        $soul = Join-Path $openclawDir "SOUL.md"
        if (Test-Path $soul) { Write-Output "SOUL.md: $((Get-Content $soul).Count) lines" }
        $agents = Join-Path $openclawDir "AGENTS.md"
        if (Test-Path $agents) { Write-Output "AGENTS.md: $((Get-Content $agents).Count) lines" }
        Write-Output ""
        Write-Output "=== Memory ==="
        $mem = Join-Path $openclawDir "MEMORY.md"
        if (Test-Path $mem) { Write-Output "MEMORY.md: $((Get-Content $mem).Count) lines" }
        $memDir = Join-Path $openclawDir "memory"
        if (Test-Path $memDir) {
            Get-ChildItem $memDir -Filter "*.md" -File | ForEach-Object {
                Write-Output "  $($_.Name): $((Get-Content $_.FullName).Count) lines"
            }
        }
        Write-Output ""
        Write-Output "=== Skills ==="
        $skillsPath = Join-Path $openclawDir "skills"
        if (Test-Path $skillsPath) {
            Get-ChildItem $skillsPath -Directory | ForEach-Object {
                if (Test-Path (Join-Path $_.FullName "SKILL.md")) {
                    Write-Output "  $($_.Name)"
                }
            }
        }
    }
    "migrate" {
        if (-not $target) {
            Write-Output "Usage: openclaw_migrate migrate <target_agent>"
            exit 1
        }
        if (-not (Test-Path $openclawDir -PathType Container)) {
            Write-Output "OpenClaw installation not found"
            exit 1
        }
        $targetDir = Join-Path $moxxyDir $target
        New-Item -ItemType Directory -Path (Join-Path $targetDir "skills") -Force | Out-Null

        $personaParts = @("# Agent Persona", "")
        $soul = Join-Path $openclawDir "SOUL.md"
        if (Test-Path $soul) {
            $personaParts += "## Core Identity", ""
            $personaParts += Get-Content $soul
            $personaParts += ""
        }
        $agents = Join-Path $openclawDir "AGENTS.md"
        if (Test-Path $agents) {
            $personaParts += "## Workspace Guidelines", ""
            $agentsContent = Get-Content $agents | Where-Object { $_ -notmatch '^## Skills' -and $_ -notmatch '^## Tools' }
            $personaParts += $agentsContent
            $personaParts += ""
        }
        $personaRaw = $personaParts -join "`n"
        $personaTransformed = Transform-Persona $personaRaw
        Set-Content -Path (Join-Path $targetDir "persona.md") -Value $personaTransformed

        $ocJson = Join-Path $openclawRoot "openclaw.json"
        if (Test-Path $ocJson) {
            $cfg = Get-Content $ocJson -Raw | ConvertFrom-Json
            $hbEvery = $cfg.agents.defaults.heartbeat.every
            if (-not $hbEvery) { $hbEvery = $cfg.heartbeat.every }
            if ($hbEvery) {
                $cron = Duration-ToCron $hbEvery
                if ($cron) {
                    $hbMd = Join-Path $openclawDir "HEARTBEAT.md"
                    $hbPrompt = if (Test-Path $hbMd) { Get-Content $hbMd -Raw } else { "Proactively check for anything needing attention (inbox, calendar, notifications). If nothing needs attention, respond briefly." }
                    $payload = @{ name = "openclaw_heartbeat"; cron = $cron; prompt = $hbPrompt } | ConvertTo-Json
                    try {
                        $r = Invoke-RestMethod -Uri "$apiBase/agents/$target/schedules" -Method Post -Headers $headers -Body $payload
                        if ($r.success) { Write-Output "Migrated: heartbeat -> scheduled job" }
                    } catch {}
                }
            }
            $agentsDir = Join-Path $openclawRoot "agents"
            $authFiles = @()
            if (Test-Path $agentsDir) {
                Get-ChildItem $agentsDir -Directory | ForEach-Object {
                    $authFile = Join-Path $_.FullName (Join-Path "agent" "auth-profiles.json")
                    if (Test-Path $authFile) { $authFiles += $authFile }
                }
            }
            foreach ($authPath in $authFiles) {
                $data = Get-Content $authPath -Raw | ConvertFrom-Json
                foreach ($name in $data.profiles.PSObject.Properties.Name) {
                    $p = $data.profiles.$name
                    if ($p.type -eq "api_key") {
                        $key = $p.provider + "_api_key"
                        $value = $p.key
                        $vaultPayload = @{ key = $key; value = $value } | ConvertTo-Json
                        Api-Post "$apiBase/agents/$target/vault" $vaultPayload
                    }
                }
                break
            }
            $primary = $cfg.agent.model.primary
            if (-not $primary) { $primary = $cfg.agents.defaults.model.primary }
            if ($primary) {
                $parts = $primary -split "/"
                $provider = $parts[0]
                $model = if ($parts.Length -gt 1) { $parts[1..($parts.Length)] -join "/" } else { "" }
                $llmPayload = @{ provider = $provider; model = $model } | ConvertTo-Json
                try {
                    $r = Invoke-RestMethod -Uri "$apiBase/agents/$target/llm" -Method Post -Headers $headers -Body $llmPayload
                    if ($r.success) { Write-Output "Migrated: LLM provider/model" }
                } catch {}
            }
        }

        $skillsPath = Join-Path $openclawDir "skills"
        if (Test-Path $skillsPath) {
            Get-ChildItem $skillsPath -Directory | ForEach-Object {
                $skillDir = $_.FullName
                if (Test-Path (Join-Path $skillDir "SKILL.md")) {
                    $skillName = $_.Name
                    $targetSkillDir = Join-Path $targetDir "skills\$skillName"
                    New-Item -ItemType Directory -Path $targetSkillDir -Force | Out-Null
                    $manifest = @"
name = "$skillName"
description = "Migrated from OpenClaw"
version = "1.0.0"
executor_type = "openclaw"
needs_network = true
needs_fs_read = false
needs_fs_write = false
needs_env = false
entrypoint = "skill.md"
run_command = ""
"@
                    Set-Content -Path (Join-Path $targetSkillDir "manifest.toml") -Value $manifest
                    $runSh = "#!/bin/sh`necho `"OpenClaw skill - see skill.md for documentation`""
                    Set-Content -Path (Join-Path $targetSkillDir "run.sh") -Value $runSh
                    Copy-Item (Join-Path $skillDir "SKILL.md") (Join-Path $targetSkillDir "skill.md")
                    Write-Output "Migrated skill: $skillName"
                }
            }
        }
        Write-Output ""
        Write-Output "Migration complete! Agent '$target' created at:"
        Write-Output "  $targetDir"
    }
    "persona" {
        if (-not $target) {
            Write-Output "Usage: openclaw_migrate persona <target_agent>"
            exit 1
        }
        $targetDir = Join-Path $moxxyDir $target
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        $personaParts = @("# Agent Persona", "")
        $soul = Join-Path $openclawDir "SOUL.md"
        if (Test-Path $soul) {
            $personaParts += "## Core Identity", ""
            $personaParts += Get-Content $soul
            $personaParts += ""
        }
        $agents = Join-Path $openclawDir "AGENTS.md"
        if (Test-Path $agents) {
            $personaParts += "## Workspace Guidelines", ""
            $personaParts += Get-Content $agents | Where-Object { $_ -notmatch '^## Skills' -and $_ -notmatch '^## Tools' }
            $personaParts += ""
        }
        $personaTransformed = Transform-Persona ($personaParts -join "`n")
        Set-Content -Path (Join-Path $targetDir "persona.md") -Value $personaTransformed
        Write-Output "Persona migrated to: $(Join-Path $targetDir 'persona.md')"
    }
    "skills" {
        if (-not $target) {
            Write-Output "Usage: openclaw_migrate skills <target_agent>"
            exit 1
        }
        $targetDir = Join-Path $moxxyDir "$target\skills"
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        $skillsPath = Join-Path $openclawDir "skills"
        if (Test-Path $skillsPath) {
            Get-ChildItem $skillsPath -Directory | ForEach-Object {
                if (Test-Path (Join-Path $_.FullName "SKILL.md")) {
                    $skillName = $_.Name
                    $targetSkillDir = Join-Path $targetDir $skillName
                    New-Item -ItemType Directory -Path $targetSkillDir -Force | Out-Null
                    $manifest = @"
name = "$skillName"
description = "Migrated from OpenClaw"
version = "1.0.0"
executor_type = "openclaw"
needs_network = true
needs_fs_read = false
needs_fs_write = false
needs_env = false
entrypoint = "skill.md"
run_command = ""
"@
                    Set-Content -Path (Join-Path $targetSkillDir "manifest.toml") -Value $manifest
                    Set-Content -Path (Join-Path $targetSkillDir "run.sh") -Value "#!/bin/sh`necho `"OpenClaw skill - see skill.md for documentation`""
                    Copy-Item (Join-Path $_.FullName "SKILL.md") (Join-Path $targetSkillDir "skill.md")
                    Write-Output "Migrated: $skillName"
                }
            }
        }
        Write-Output "Skills migrated to: $targetDir"
    }
    default {
        Write-Output "Unknown subcommand: $subcmd"
        Write-Output "Available: check, list, migrate, persona, skills"
        exit 1
    }
}
