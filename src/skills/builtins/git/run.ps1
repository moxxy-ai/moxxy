$ErrorActionPreference = "Stop"

# Built-in Skill: git (local only) - Managed worktree helpers
# For GitHub API actions (issues, PRs, forks), use the "github" skill instead.

$env:GIT_AUTHOR_NAME = if ($env:GIT_USER_NAME) { $env:GIT_USER_NAME } else { if ($env:AGENT_NAME) { $env:AGENT_NAME } else { "MoxxyAgent" } }
$env:GIT_COMMITTER_NAME = $env:GIT_AUTHOR_NAME
$env:GIT_AUTHOR_EMAIL = if ($env:GIT_USER_EMAIL) { $env:GIT_USER_EMAIL } else { "$(if ($env:AGENT_NAME) { $env:AGENT_NAME } else { 'agent' })@moxxy.local" }
$env:GIT_COMMITTER_EMAIL = $env:GIT_AUTHOR_EMAIL

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Error: 'git' is not installed on this system."
    exit 1
}

$workspaceRoot = if ($env:AGENT_WORKSPACE) { $env:AGENT_WORKSPACE } else { (Get-Location).Path }
$stateDir = Join-Path $workspaceRoot ".moxxy-git"
$reposDir = Join-Path $stateDir "repos"
$worktreesDir = Join-Path $stateDir "worktrees"
$activeFile = Join-Path $stateDir "active-worktree"

function Slugify($raw) {
    if (-not $raw) { return "" }
    $s = $raw.ToLower() -replace '[^a-z0-9._/-]+', '-' -replace '/{2,}', '/' -replace '^[-/]+|[-/]+$', '' -replace '/', '__'
    return $s
}

function To-RepoUrl($input) {
    if ($input -match '^https?://' -or $input -match '^git@') { return $input }
    if ($input -match '^[^/\s]+/[^/\s]+$') { return "https://github.com/$input.git" }
    if (Test-Path $input -PathType Container) {
        Push-Location $input
        $p = (Get-Location).Path
        Pop-Location
        return $p
    }
    return $input
}

function RepoId-FromInput($input) {
    $norm = $input -replace '^[^:]+://', '' -replace '^git@', '' -replace '\.git$', '' -replace '[/:]', '/'
    return Slugify $norm
}

function Is-GitRepo($dir) {
    if (-not (Test-Path $dir -PathType Container)) { return $false }
    Push-Location $dir
    git rev-parse --is-inside-work-tree 2>$null | Out-Null
    $ok = $LASTEXITCODE -eq 0
    Pop-Location
    return $ok
}

function Ensure-StateDirs {
    New-Item -ItemType Directory -Path $reposDir, $worktreesDir -Force | Out-Null
}

function Set-ActiveWorktree($target) {
    Push-Location $target
    $resolved = (Get-Location).Path
    Pop-Location
    Ensure-StateDirs
    Set-Content -Path $activeFile -Value $resolved
}

function Get-ActiveWorktree {
    if (-not (Test-Path $activeFile)) { return $null }
    $target = Get-Content $activeFile -Raw
    if (-not $target) { return $null }
    $target = $target.Trim()
    if (-not (Is-GitRepo $target)) { return $null }
    return $target
}

function Discover-SingleWorktree {
    if (-not (Test-Path $worktreesDir)) { return $null }
    $dirs = Get-ChildItem $worktreesDir -Directory -Recurse | Where-Object {
        $_.FullName.Replace($worktreesDir, '').TrimStart('\', '/').Split('\', '/').Length -eq 2
    } | Sort-Object FullName
    $arr = @($dirs)
    if ($arr.Count -ne 1) { return $null }
    $first = $arr[0].FullName
    if (-not (Is-GitRepo $first)) { return $null }
    return $first
}

function Sync-RepoMirror($repoUrl, $repoId) {
    $bareRepo = Join-Path $reposDir "$repoId.git"
    if (Test-Path $bareRepo) {
        Push-Location $bareRepo
        git fetch --all --prune 2>&1 | Out-Null
        Pop-Location
    } else {
        git clone --bare $repoUrl $bareRepo 2>&1 | Out-Null
    }
    return $bareRepo
}

function Resolve-BaseRef($bareRepo, $requested) {
    if ($requested) {
        Push-Location $bareRepo
        git show-ref --verify --quiet "refs/remotes/origin/$requested" 2>$null
        if ($LASTEXITCODE -eq 0) { Pop-Location; return "origin/$requested" }
        git show-ref --verify --quiet "refs/heads/$requested" 2>$null
        if ($LASTEXITCODE -eq 0) { Pop-Location; return $requested }
        Pop-Location
        Write-Error "Error: base branch '$requested' not found in mirror."
        exit 1
    }
    Push-Location $bareRepo
    $headRef = git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null
    if ($headRef) { Pop-Location; return $headRef }
    foreach ($c in @("origin/main", "origin/master")) {
        git show-ref --verify --quiet "refs/remotes/$c" 2>$null
        if ($LASTEXITCODE -eq 0) { Pop-Location; return $c }
    }
    $firstRemote = git for-each-ref --format='%(refname:short)' refs/remotes/origin 2>$null | Where-Object { $_ -ne 'origin/HEAD' } | Select-Object -First 1
    Pop-Location
    if ($firstRemote) { return $firstRemote }
    Write-Error "Error: could not determine a base reference for new worktree."
    exit 1
}

function Find-WorktreeTarget($target) {
    if ((Test-Path $target -PathType Container) -and (Is-GitRepo $target)) {
        Push-Location $target
        $resolved = (Get-Location).Path
        Pop-Location
        return $resolved
    }
    if ($env:AGENT_WORKSPACE) {
        $cand = Join-Path $env:AGENT_WORKSPACE $target
        if ((Test-Path $cand -PathType Container) -and (Is-GitRepo $cand)) {
            Push-Location $cand
            $resolved = (Get-Location).Path
            Pop-Location
            return $resolved
        }
    }
    if (-not (Test-Path $worktreesDir)) { return $null }
    $matches = Get-ChildItem $worktreesDir -Directory -Recurse | Where-Object {
        $_.FullName.Replace($worktreesDir, '').TrimStart('\', '/').Split('\', '/').Length -eq 2 -and $_.Name -eq $target
    } | Sort-Object FullName
    $arr = @($matches)
    if ($arr.Count -eq 1) { return $arr[0].FullName }
    if ($arr.Count -gt 1) {
        Write-Error "Error: multiple worktrees match '$target'. Use an explicit path."
        exit 1
    }
    return $null
}

function Handle-WsCommand {
    param($sub, [string[]]$rest)
    Ensure-StateDirs
    switch ($sub) {
        "init" {
            $repoInput = $rest[0]
            $baseBranch = $rest[1]
            $taskName = if ($rest[2]) { $rest[2] } else { "task" }
            if (-not $repoInput) {
                Write-Output "Usage: git ws init <repo> [base_branch] [task_name]"
                exit 1
            }
            $repoUrl = To-RepoUrl $repoInput
            $repoId = RepoId-FromInput $repoInput
            if (-not $repoId) {
                Write-Error "Error: could not derive repository identifier from '$repoInput'."
                exit 1
            }
            $bareRepo = Sync-RepoMirror $repoUrl $repoId
            $baseRef = Resolve-BaseRef $bareRepo $baseBranch
            $taskSlug = Slugify $taskName
            if (-not $taskSlug) { $taskSlug = "task" }
            $ts = Get-Date -Format "yyyyMMdd-HHmmss"
            $worktreeName = "$taskSlug-$ts"
            $worktreeDir = Join-Path $worktreesDir (Join-Path $repoId $worktreeName)
            New-Item -ItemType Directory -Path (Join-Path $worktreesDir $repoId) -Force | Out-Null
            Push-Location $bareRepo
            git worktree add $worktreeDir $baseRef 2>&1 | Out-Null
            Pop-Location
            $branchName = "moxxy/$taskSlug-$ts"
            Push-Location $worktreeDir
            git checkout -b $branchName 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0) {
                $branchName = "moxxy/$taskSlug-$ts-$RANDOM"
                git checkout -b $branchName 2>&1 | Out-Null
            }
            Pop-Location
            Set-ActiveWorktree $worktreeDir
            $active = Get-ActiveWorktree
            Write-Output "Initialized isolated worktree."
            Write-Output "repo: $repoInput"
            Write-Output "base: $baseRef"
            Write-Output "branch: $branchName"
            Write-Output "path: $active"
        }
        "list" {
            $active = Get-ActiveWorktree
            $found = 0
            if (Test-Path $worktreesDir) {
                Get-ChildItem $worktreesDir -Directory -Recurse | Where-Object {
                    $_.FullName.Replace($worktreesDir, '').TrimStart('\', '/').Split('\', '/').Length -eq 2
                } | Sort-Object FullName | ForEach-Object {
                    $found = 1
                    $resolved = $_.FullName
                    $marker = if ($active -and $resolved -eq $active) { "*" } else { " " }
                    Write-Output "$marker $resolved"
                }
            }
            if ($found -eq 0) { Write-Output "No managed worktrees found." }
        }
        "use" {
            $target = $rest[0]
            if (-not $target) {
                Write-Output "Usage: git ws use <worktree_path_or_name>"
                exit 1
            }
            $resolved = Find-WorktreeTarget $target
            if (-not $resolved) {
                Write-Error "Error: worktree not found: $target"
                exit 1
            }
            Set-ActiveWorktree $resolved
            Write-Output "Active worktree: $resolved"
        }
        "active" {
            $active = Get-ActiveWorktree
            if (-not $active) {
                Write-Error "No active worktree. Use 'git ws init ...' or 'git ws use ...' first."
                exit 1
            }
            Write-Output $active
        }
        { $_ -in "help", "--help", "-h", "" } {
            Write-Output @"
Usage:
  git ws init <repo> [base_branch] [task_name]
  git ws list
  git ws use <worktree_path_or_name>
  git ws active

Examples:
  git ws init moxxy-ai/moxxy main fix-telemetry
  git ws list
  git ws use fix-telemetry-20260225-103000
  git status
"@
        }
        default {
            Write-Error "Unknown ws command: $sub"
            exit 1
        }
    }
}

function Run-GitWithActiveContext {
    param([string[]]$gitArgs)
    $cmd = $gitArgs[0]
    $repoIndependent = @($null, "", "help", "--help", "version", "--version", "clone", "init", "ls-remote")
    if ($cmd -in $repoIndependent) {
        Set-Location $workspaceRoot
        & git @gitArgs
        exit $LASTEXITCODE
    }
    if ($cmd -eq "config" -and $gitArgs[1] -in "--global", "--system") {
        Set-Location $workspaceRoot
        & git @gitArgs
        exit $LASTEXITCODE
    }
    if (Is-GitRepo (Get-Location).Path) {
        & git @gitArgs
        exit $LASTEXITCODE
    }
    $active = Get-ActiveWorktree
    if ($active) {
        Push-Location $active
        & git @gitArgs
        $ex = $LASTEXITCODE
        Pop-Location
        exit $ex
    }
    $active = Discover-SingleWorktree
    if ($active) {
        Set-ActiveWorktree $active
        Push-Location $active
        & git @gitArgs
        $ex = $LASTEXITCODE
        Pop-Location
        exit $ex
    }
    if ($env:AGENT_WORKSPACE -and (Is-GitRepo $env:AGENT_WORKSPACE)) {
        Push-Location $env:AGENT_WORKSPACE
        & git @gitArgs
        $ex = $LASTEXITCODE
        Pop-Location
        exit $ex
    }
    Write-Error "Error: no active repository context."
    Write-Output "Initialize a worktree first: git ws init <owner/repo> [base_branch] [task_name]"
    Write-Output "Or run git with an explicit path: git -C <repo_path> <command>"
    exit 1
}

# Main
$first = $args[0]
if ($first -eq "ws") {
    $rest = $args[1..($args.Length)]
    Handle-WsCommand -sub $rest[0] -rest $rest[1..($rest.Length)]
    exit 0
}
if ($first -eq "-C" -and $args.Count -ge 2) {
    $targetDir = $args[1]
    & git @args
    if ($LASTEXITCODE -eq 0 -and (Is-GitRepo $targetDir)) {
        Set-ActiveWorktree $targetDir
    }
    exit $LASTEXITCODE
}
Run-GitWithActiveContext $args
