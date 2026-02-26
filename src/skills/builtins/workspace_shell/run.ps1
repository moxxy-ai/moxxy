$ErrorActionPreference = "Stop"

# Workspace-locked shell: runs commands only within $AGENT_WORKSPACE
# Usage: workspace_shell <subdir_within_workspace> <command>

$subdir = $args[0]
$cmd = $args[1]

if (-not $cmd) {
    Write-Output "Usage: workspace_shell <subdir_within_workspace> <command>"
    Write-Output "Example: workspace_shell myrepo `"npm install; npm run build`""
    exit 1
}

if (-not $env:AGENT_WORKSPACE) {
    Write-Output "Error: AGENT_WORKSPACE is not set"
    exit 1
}

$target = if ($subdir) {
    Join-Path $env:AGENT_WORKSPACE $subdir
} else {
    $env:AGENT_WORKSPACE
}

if (-not (Test-Path $target -PathType Container)) {
    Write-Output "Error: directory does not exist: $target"
    exit 1
}

$resolvedTarget = (Resolve-Path $target).Path
$resolvedWorkspace = (Resolve-Path $env:AGENT_WORKSPACE).Path

if (-not $resolvedTarget.StartsWith($resolvedWorkspace)) {
    Write-Output "Error: resolved path '$resolvedTarget' is outside workspace"
    exit 1
}

Push-Location $resolvedTarget
try {
    Invoke-Expression $cmd
} finally {
    Pop-Location
}
