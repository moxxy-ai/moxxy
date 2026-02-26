$ErrorActionPreference = "Stop"

# skill: Unified skill management tool.
# Subcommands: list, install, remove, upgrade, modify, create, read, check

$agentName = if ($env:AGENT_NAME) { $env:AGENT_NAME } else { "default" }
$api = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$headers = @{ "Content-Type" = "application/json" }
if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers["X-Moxxy-Internal-Token"] = $env:MOXXY_INTERNAL_TOKEN
}

function Esc-Json($s) {
    if (-not $s) { return "" }
    ($s -replace '\\', '\\\\' -replace '"', '\"').Replace("`n", "\n").Replace("`r", "")
}

$subcmd = $args[0]
$remaining = $args[1..($args.Length)]

function Check-Skill {
    param($skillDir)
    $skillName = Split-Path $skillDir -Leaf
    $issues = @()
    if (-not (Test-Path (Join-Path $skillDir "manifest.toml"))) {
        $issues += "  - MISSING manifest.toml"
    }
    $runFile = $null
    if (Test-Path (Join-Path $skillDir "run.sh")) { $runFile = Join-Path $skillDir "run.sh" }
    elseif (Test-Path (Join-Path $skillDir "run.ps1")) { $runFile = Join-Path $skillDir "run.ps1" }
    elseif (Test-Path (Join-Path $skillDir "run.py")) { $runFile = Join-Path $skillDir "run.py" }
    else {
        $issues += "  - MISSING entrypoint (run.sh, run.ps1, or run.py)"
    }
    if ($runFile -and (Test-Path $runFile)) {
        $content = Get-Content $runFile -Raw -ErrorAction SilentlyContinue
        if ($content -match '\bjq\b') {
            $issues += "  - USES jq (not portable). Replace with grep/sed/awk or PowerShell equivalents."
        }
        $firstLine = (Get-Content $runFile -First 1 -ErrorAction SilentlyContinue)
        if ($firstLine -notmatch '^#!') {
            $issues += "  - MISSING shebang line (should start with #!/bin/sh or similar)"
        }
    }
    if (-not (Test-Path (Join-Path $skillDir "skill.md"))) {
        $issues += "  - MISSING skill.md (LLM won't know how to use this skill)"
    }
    if ($issues.Count -gt 0) {
        Write-Output "[FAIL] $skillName`:"
        $issues | ForEach-Object { Write-Output $_ }
        return $false
    }
    Write-Output "[OK]   $skillName"
    return $true
}

switch ($subcmd) {
    "list" {
        Invoke-RestMethod -Uri "$api/agents/$agentName/skills" -Headers $headers | ConvertTo-Json -Depth 10
    }
    "install" {
        if (-not $remaining[0]) {
            Write-Output "Usage: skill install <url_or_manifest> [run_sh] [skill_md]"
            exit 1
        }
        if ($remaining[1]) {
            $manifest = $remaining[0]
            $runSh = $remaining[1]
            $skillMd = if ($remaining[2]) { $remaining[2] } else { "# Skill" }
            $body = @{
                new_manifest_content = $manifest
                new_run_sh = $runSh
                new_skill_md = $skillMd
            } | ConvertTo-Json
            Invoke-RestMethod -Uri "$api/agents/$agentName/install_skill" -Method Post -Headers $headers -Body $body
            exit 0
        }
        $baseUrl = $remaining[0]
        $isOpenClaw = $false
        if ($baseUrl -match '\.md$') { $isOpenClaw = $true }
        else {
            try {
                $h = @{ Range = "bytes=0-3" }
                $resp = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -Headers $h -ErrorAction Stop
                if ($resp.Content -and $resp.Content.StartsWith("---")) { $isOpenClaw = $true }
            } catch {
                try {
                    $resp = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -ErrorAction Stop
                    if ($resp.Content -and $resp.Content.TrimStart().StartsWith("---")) { $isOpenClaw = $true }
                } catch {}
            }
        }
        if ($isOpenClaw) {
            $body = @{ url = $baseUrl } | ConvertTo-Json
            Invoke-RestMethod -Uri "$api/agents/$agentName/install_openclaw_skill" -Method Post -Headers $headers -Body $body
            exit 0
        }
        Write-Output "Fetching manifest.toml from ${baseUrl}/manifest.toml..."
        $manifest = (Invoke-WebRequest -Uri "$baseUrl/manifest.toml" -UseBasicParsing -ErrorAction Stop).Content
        Write-Output "Fetching run.sh from ${baseUrl}/run.sh..."
        $runSh = (Invoke-WebRequest -Uri "$baseUrl/run.sh" -UseBasicParsing -ErrorAction Stop).Content
        Write-Output "Fetching skill.md from ${baseUrl}/skill.md..."
        try {
            $skillMd = (Invoke-WebRequest -Uri "$baseUrl/skill.md" -UseBasicParsing -ErrorAction Stop).Content
        } catch {
            $skillMd = "# Skill"
        }
        $body = @{
            new_manifest_content = $manifest
            new_run_sh = $runSh
            new_skill_md = $skillMd
        } | ConvertTo-Json
        Invoke-RestMethod -Uri "$api/agents/$agentName/install_skill" -Method Post -Headers $headers -Body $body
    }
    "remove" {
        if (-not $remaining[0]) {
            Write-Output "Usage: skill remove <skill_name>"
            exit 1
        }
        Invoke-RestMethod -Uri "$api/agents/$agentName/skills/$($remaining[0])" -Method Delete -Headers $headers
    }
    "upgrade" {
        if (-not $remaining[0] -or -not $remaining[1] -or -not $remaining[2] -or -not $remaining[3]) {
            Write-Output "Usage: skill upgrade <skill_name> <new_version> <manifest_toml> <run_sh> [skill_md]"
            exit 1
        }
        $skillName = $remaining[0]
        $newVersion = $remaining[1]
        $newManifest = $remaining[2]
        $newRunSh = $remaining[3]
        $newSkillMd = if ($remaining[4]) { $remaining[4] } else { "# $skillName" }
        $body = @{
            skill_name = $skillName
            new_version_str = $newVersion
            new_manifest_content = $newManifest
            new_run_sh = $newRunSh
            new_skill_md = $newSkillMd
        } | ConvertTo-Json
        Invoke-RestMethod -Uri "$api/agents/$agentName/upgrade_skill" -Method Post -Headers $headers -Body $body
    }
    "modify" {
        if (-not $remaining[0] -or -not $remaining[1] -or -not $remaining[2]) {
            Write-Output "Usage: skill modify <skill_name> <file_name> <new_content>"
            exit 1
        }
        $body = @{
            skill_name = $remaining[0]
            file_name = $remaining[1]
            content = $remaining[2]
        } | ConvertTo-Json
        Invoke-RestMethod -Uri "$api/agents/$agentName/skills/$($remaining[0])" -Method Patch -Headers $headers -Body $body
    }
    "create" {
        if (-not $remaining[0] -or -not $remaining[1]) {
            Write-Output "Usage: skill create <skill_name> <description> [--platform all|windows|macos|linux]"
            Write-Output "  --platform: all (default) = both run.sh+run.ps1, windows = run.ps1 only, macos/linux = run.sh only"
            exit 1
        }
        $skillName = $remaining[0]
        $description = $remaining[1]
        $platform = $null
        $i = 2
        while ($i -lt $remaining.Length) {
            if ($remaining[$i] -eq "--platform" -and ($i + 1) -lt $remaining.Length) {
                $platform = $remaining[$i + 1]
                $i += 2
            } else { $i++ }
        }
        $body = @{ name = $skillName; description = $description }
        if ($platform) { $body["platform"] = $platform }
        $result = Invoke-RestMethod -Uri "$api/agents/$agentName/create_skill" -Method Post -Headers $headers -Body ($body | ConvertTo-Json)
        if ($result.success) {
            Write-Output "Skill '$skillName' created and registered successfully."
        } else {
            Write-Output "ERROR: Failed to create skill '$skillName': $($result.error)"
            exit 1
        }
    }
    "read" {
        if (-not $remaining[0]) {
            Write-Output "Usage: skill read <skill_name>"
            exit 1
        }
        $skillsBase = Split-Path (Get-Location) -Parent
        $skillDir = Join-Path $skillsBase $remaining[0]
        if (-not (Test-Path $skillDir -PathType Container)) {
            Write-Output "Skill $($remaining[0]) does not exist."
            exit 1
        }
        Write-Output "--- manifest.toml ---"
        Get-Content (Join-Path $skillDir "manifest.toml")
        Write-Output ""
        Write-Output "--- skill.md ---"
        Get-Content (Join-Path $skillDir "skill.md")
        Write-Output ""
        $runSh = Join-Path $skillDir "run.sh"
        $runPs1 = Join-Path $skillDir "run.ps1"
        if (Test-Path $runSh) {
            Write-Output "--- run.sh ---"
            Get-Content $runSh
        } elseif (Test-Path $runPs1) {
            Write-Output "--- run.ps1 ---"
            Get-Content $runPs1
        }
    }
    "check" {
        $skillsBase = Split-Path (Get-Location) -Parent
        $target = $remaining[0]
        if ($target) {
            $skillDir = Join-Path $skillsBase $target
            if (-not (Test-Path $skillDir -PathType Container)) {
                Write-Output "Skill '$target' not found."
                exit 1
            }
            $ok = Check-Skill $skillDir
            exit (if ($ok) { 0 } else { 1 })
        }
        Write-Output "Checking all skills for common problems..."
        Write-Output ""
        $total = 0
        $failed = 0
        Get-ChildItem $skillsBase -Directory | ForEach-Object {
            $total++
            if (-not (Check-Skill $_.FullName)) { $failed++ }
        }
        Write-Output ""
        Write-Output "Checked $total skills: $($total - $failed) OK, $failed with issues."
        if ($failed -gt 0) {
            Write-Output ""
            Write-Output "To fix a skill: skill read <name>, then skill modify <name> run.sh '<fixed content>'"
            exit 1
        }
    }
    default {
        Write-Output "Unknown subcommand: $subcmd"
        Write-Output "Available: list, install, remove, upgrade, modify, create, read, check"
        exit 1
    }
}
