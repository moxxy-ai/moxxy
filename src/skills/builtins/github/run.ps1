$ErrorActionPreference = "Stop"

# Built-in Skill: github - Interact with GitHub via REST API
# Requires GITHUB_TOKEN in vault

$GITHUB_API = "https://api.github.com"
$action = $args[0]

if (-not $env:GITHUB_TOKEN) {
    Write-Output "Error: GITHUB_TOKEN is not set in your vault."
    Write-Output ""
    Write-Output "Set it via the vault skill:"
    Write-Output '  <invoke name="manage_vault">["set", "GITHUB_TOKEN", "ghp_your_token_here"]</invoke>'
    Write-Output ""
    Write-Output "Create a token at https://github.com/settings/tokens (classic, with 'repo' scope)."
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $($env:GITHUB_TOKEN)"
    "Accept" = "application/vnd.github+json"
    "Content-Type" = "application/json"
}

# Normalize aliases
switch ($action) {
    "create-issue" { $action = "issue" }
    "create_issue" { $action = "issue" }
    "create-issues" { $action = "issue" }
    "create-pr" { $action = "pr" }
    "create_pr" { $action = "pr" }
    "pull-request" { $action = "pr" }
    "pull_request" { $action = "pr" }
    "open-pr" { $action = "pr" }
    "clone" { $action = "clone" }
    "clone-repo" { $action = "clone" }
    "clone_repo" { $action = "clone" }
    "comment" { $action = "comment" }
    "comment-issue" { $action = "comment" }
    "comment_issue" { $action = "comment" }
    "list-issues" { $action = "list_issues" }
    "list_issues" { $action = "list_issues" }
    "issues" { $action = "list_issues" }
    "list-prs" { $action = "list_prs" }
    "list_prs" { $action = "list_prs" }
    "prs" { $action = "list_prs" }
    "pulls" { $action = "list_prs" }
}

switch ($action) {
    "issue" {
        $repo = $args[1]
        $title = $args[2]
        $body = $args[3]
        if (-not $repo -or -not $title) {
            Write-Output "Usage: github issue <owner/repo> <title> [body]"
            exit 1
        }
        $payload = @{ title = $title; body = $body } | ConvertTo-Json
        try {
            $r = Invoke-RestMethod -Uri "$GITHUB_API/repos/$repo/issues" -Method Post -Headers $headers -Body $payload
            Write-Output "Issue #$($r.number) created: $($r.html_url)"
        } catch {
            Write-Output "Failed (HTTP $($_.Exception.Response.StatusCode.value__))."
            Write-Output $_.ErrorDetails.Message
            exit 1
        }
    }
    "fork" {
        $repo = $args[1]
        if (-not $repo) {
            Write-Output "Usage: github fork <owner/repo>"
            exit 1
        }
        try {
            $r = Invoke-RestMethod -Uri "$GITHUB_API/repos/$repo/forks" -Method Post -Headers $headers -Body '{}'
            Write-Output "Forked: $($r.full_name) - $($r.html_url)"
        } catch {
            Write-Output "Failed (HTTP $($_.Exception.Response.StatusCode.value__))."
            Write-Output $_.ErrorDetails.Message
            exit 1
        }
    }
    "clone" {
        $repo = $args[1]
        $targetDir = $args[2]
        if (-not $repo) {
            Write-Output "Usage: github clone <owner/repo> [target_directory]"
            exit 1
        }
        $repoName = $repo.Split("/")[-1]
        if (-not $targetDir) {
            if ($env:AGENT_WORKSPACE) {
                $targetDir = Join-Path $env:AGENT_WORKSPACE $repoName
            } else {
                $targetDir = Join-Path $env:TEMP "git-$repoName-$PID"
            }
        }
        $cloneUrl = "https://$($env:GITHUB_TOKEN)@github.com/$repo.git"
        try {
            & git clone $cloneUrl $targetDir 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Output "Failed to clone repository."
                exit 1
            }
            Write-Output "Cloned $repo to $targetDir"
        } catch {
            Write-Output "Failed to clone repository."
            exit 1
        }
    }
    "pr" {
        $repo = $args[1]
        $title = $args[2]
        $description = $args[3]
        $head = $args[4]
        $base = if ($args[5]) { $args[5] } else { "main" }
        if (-not $repo -or -not $title -or -not $head) {
            Write-Output "Usage: github pr <owner/repo> <title> <description> <user:branch> [base]"
            exit 1
        }
        $payload = @{
            title = $title
            body = $description
            head = $head
            base = $base
            draft = $true
        } | ConvertTo-Json
        try {
            $r = Invoke-RestMethod -Uri "$GITHUB_API/repos/$repo/pulls" -Method Post -Headers $headers -Body $payload
            Write-Output "Draft PR #$($r.number) created: $($r.html_url)"
        } catch {
            Write-Output "Failed (HTTP $($_.Exception.Response.StatusCode.value__))."
            Write-Output $_.ErrorDetails.Message
            exit 1
        }
    }
    "comment" {
        $repo = $args[1]
        $issueNumber = $args[2]
        $commentBody = $args[3]
        if (-not $repo -or -not $issueNumber -or -not $commentBody) {
            Write-Output "Usage: github comment <owner/repo> <issue_number> <body>"
            exit 1
        }
        $payload = @{ body = $commentBody } | ConvertTo-Json
        try {
            $r = Invoke-RestMethod -Uri "$GITHUB_API/repos/$repo/issues/$issueNumber/comments" -Method Post -Headers $headers -Body $payload
            Write-Output "Comment posted: $($r.html_url)"
        } catch {
            Write-Output "Failed (HTTP $($_.Exception.Response.StatusCode.value__))."
            Write-Output $_.ErrorDetails.Message
            exit 1
        }
    }
    "list_issues" {
        $repo = $args[1]
        if (-not $repo) {
            Write-Output "Usage: github list_issues <owner/repo>"
            exit 1
        }
        try {
            $r = Invoke-RestMethod -Uri "$GITHUB_API/repos/$repo/issues?state=open&per_page=20" -Headers $headers
            Write-Output "Open issues on $repo`:"
            $count = 0
            foreach ($item in $r) {
                if ($item.pull_request) { continue }
                Write-Output "#$($item.number) $($item.title) - $($item.html_url)"
                $count++
            }
            if ($count -eq 0) { Write-Output "  No open issues." }
        } catch {
            Write-Output "Failed: $_"
            exit 1
        }
    }
    "list_prs" {
        $repo = $args[1]
        if (-not $repo) {
            Write-Output "Usage: github list_prs <owner/repo>"
            exit 1
        }
        try {
            $r = Invoke-RestMethod -Uri "$GITHUB_API/repos/$repo/pulls?state=open&per_page=20" -Headers $headers
            Write-Output "Open PRs on $repo`:"
            $count = 0
            foreach ($item in $r) {
                $status = if ($item.draft) { "DRAFT" } else { "OPEN" }
                Write-Output "#$($item.number) $($item.title) [$status] - $($item.html_url)"
                $count++
            }
            if ($count -eq 0) { Write-Output "  No open PRs." }
        } catch {
            Write-Output "Failed: $_"
            exit 1
        }
    }
    default {
        Write-Output "Unknown action: $action"
        Write-Output ""
        Write-Output "Available actions: issue, pr, fork, clone, comment, list_issues, list_prs"
        Write-Output "Example: github issue owner/repo `"Title`" `"Body`""
        exit 1
    }
}
