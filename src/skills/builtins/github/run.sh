#!/usr/bin/env bash

# Built-in Skill: github
# Interact with any GitHub repository via the GitHub REST API.

set -eu

API="https://api.github.com"

ACTION="${1:-}"

if [ -z "$ACTION" ]; then
    echo "Usage: github <action> [arguments...]"
    echo "Actions: issue, pr, fork, clone, comment_issue, list_issues, list_prs"
    echo "Error: Missing action."
    exit 1
fi

# Check for GitHub token
if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "Error: GITHUB_TOKEN is not set in your vault."
    echo ""
    echo "To use the github skill, you need a GitHub Personal Access Token."
    echo ""
    echo "Option 1 - Set it via the web dashboard:"
    echo "  Go to the Vault tab → Add a secret with the exact name: GITHUB_TOKEN"
    echo ""
    echo "Option 2 - Set it via the vault skill:"
    echo '  <invoke name="manage_vault">["set", "GITHUB_TOKEN", "ghp_your_token_here"]</invoke>'
    echo ""
    echo "How to create a token:"
    echo "  1. Go to https://github.com/settings/tokens"
    echo "  2. Generate a new token (classic) with 'repo' scope"
    echo "  3. Copy the token and store it using one of the options above"
    exit 1
fi

AUTH_HEADER="Authorization: Bearer $GITHUB_TOKEN"

case "$ACTION" in
    issue)
        REPO="${2:-}"
        TITLE="${3:-}"
        BODY="${4:-}"

        if [ -z "$REPO" ] || [ -z "$TITLE" ] || [ -z "$BODY" ]; then
            echo "Usage: github issue <owner/repo> <title> <body>"
            echo "Error: repo, title, and body are required."
            exit 1
        fi

        PAYLOAD=$(jq -n \
            --arg title "$TITLE" \
            --arg body "$BODY" \
            '{title: $title, body: $body}')

        response=$(curl -s -w "\n%{http_code}" -X POST "$API/repos/$REPO/issues" \
            -H "$AUTH_HEADER" \
            -H "Content-Type: application/json" \
            -H "Accept: application/vnd.github+json" \
            -d "$PAYLOAD")

        body=$(echo "$response" | sed '$d')
        status_code=$(echo "$response" | tail -n 1)

        if [ "$status_code" = "201" ]; then
            issue_url=$(echo "$body" | jq -r '.html_url // empty')
            issue_number=$(echo "$body" | jq -r '.number // empty')
            echo "Issue #$issue_number created successfully!"
            echo "URL: $issue_url"
        else
            echo "Failed to create issue (HTTP $status_code)."
            echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body"
            exit 1
        fi
        ;;

    fork)
        REPO="${2:-}"

        if [ -z "$REPO" ]; then
            echo "Usage: github fork <owner/repo>"
            echo "Error: repo is required."
            exit 1
        fi

        response=$(curl -s -w "\n%{http_code}" -X POST "$API/repos/$REPO/forks" \
            -H "$AUTH_HEADER" \
            -H "Accept: application/vnd.github+json" \
            -d '{}')

        body=$(echo "$response" | sed '$d')
        status_code=$(echo "$response" | tail -n 1)

        if [ "$status_code" = "202" ] || [ "$status_code" = "200" ]; then
            fork_url=$(echo "$body" | jq -r '.html_url // empty')
            full_name=$(echo "$body" | jq -r '.full_name // empty')
            echo "Fork created successfully!"
            echo "Repository: $full_name"
            echo "URL: $fork_url"
        else
            echo "Failed to fork repository (HTTP $status_code)."
            echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body"
            exit 1
        fi
        ;;

    clone)
        REPO="${2:-}"
        TARGET_DIR="${3:-}"

        if [ -z "$REPO" ]; then
            echo "Usage: github clone <owner/repo> [target_directory]"
            echo "Error: repo is required."
            exit 1
        fi

        # Extract repo name for default directory
        REPO_NAME=$(echo "$REPO" | cut -d'/' -f2)

        if [ -z "$TARGET_DIR" ]; then
            TARGET_DIR="/tmp/github-${REPO_NAME}-$$"
        fi

        # Try authenticated clone first (works for private repos)
        CLONE_URL="https://${GITHUB_TOKEN}@github.com/${REPO}.git"

        echo "Cloning $REPO to $TARGET_DIR ..."
        git clone --depth 1 "$CLONE_URL" "$TARGET_DIR" 2>&1

        if [ $? -ne 0 ]; then
            echo "Failed to clone repository."
            exit 1
        fi

        echo "Cloned successfully!"
        echo "Directory: $TARGET_DIR"
        ;;

    pr)
        REPO="${2:-}"
        TITLE="${3:-}"
        DESCRIPTION="${4:-}"
        HEAD="${5:-}"
        BASE="${6:-main}"

        if [ -z "$REPO" ] || [ -z "$TITLE" ] || [ -z "$DESCRIPTION" ] || [ -z "$HEAD" ]; then
            echo "Usage: github pr <owner/repo> <title> <description> <head_user:branch> [base_branch]"
            echo "Error: repo, title, description, and head are required. base defaults to 'main'."
            exit 1
        fi

        PAYLOAD=$(jq -n \
            --arg title "$TITLE" \
            --arg body "$DESCRIPTION" \
            --arg head "$HEAD" \
            --arg base "$BASE" \
            '{title: $title, body: $body, head: $head, base: $base, draft: true}')

        response=$(curl -s -w "\n%{http_code}" -X POST "$API/repos/$REPO/pulls" \
            -H "$AUTH_HEADER" \
            -H "Content-Type: application/json" \
            -H "Accept: application/vnd.github+json" \
            -d "$PAYLOAD")

        body=$(echo "$response" | sed '$d')
        status_code=$(echo "$response" | tail -n 1)

        if [ "$status_code" = "201" ]; then
            pr_url=$(echo "$body" | jq -r '.html_url // empty')
            pr_number=$(echo "$body" | jq -r '.number // empty')
            echo "Draft PR #$pr_number created successfully!"
            echo "URL: $pr_url"
        else
            echo "Failed to create PR (HTTP $status_code)."
            echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body"
            exit 1
        fi
        ;;

    comment_issue)
        REPO="${2:-}"
        ISSUE_NUMBER="${3:-}"
        COMMENT_BODY="${4:-}"

        if [ -z "$REPO" ] || [ -z "$ISSUE_NUMBER" ] || [ -z "$COMMENT_BODY" ]; then
            echo "Usage: github comment_issue <owner/repo> <issue_number> <body>"
            echo "Error: repo, issue_number, and body are required."
            exit 1
        fi

        PAYLOAD=$(jq -n --arg body "$COMMENT_BODY" '{body: $body}')

        response=$(curl -s -w "\n%{http_code}" -X POST "$API/repos/$REPO/issues/$ISSUE_NUMBER/comments" \
            -H "$AUTH_HEADER" \
            -H "Content-Type: application/json" \
            -H "Accept: application/vnd.github+json" \
            -d "$PAYLOAD")

        body=$(echo "$response" | sed '$d')
        status_code=$(echo "$response" | tail -n 1)

        if [ "$status_code" = "201" ]; then
            comment_url=$(echo "$body" | jq -r '.html_url // empty')
            echo "Comment posted successfully!"
            echo "URL: $comment_url"
        else
            echo "Failed to post comment (HTTP $status_code)."
            echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body"
            exit 1
        fi
        ;;

    list_issues)
        REPO="${2:-}"

        if [ -z "$REPO" ]; then
            echo "Usage: github list_issues <owner/repo>"
            echo "Error: repo is required."
            exit 1
        fi

        response=$(curl -s "$API/repos/$REPO/issues?state=open&per_page=20" \
            -H "$AUTH_HEADER" \
            -H "Accept: application/vnd.github+json")

        echo "=== Open issues on $REPO ==="
        echo "$response" | jq -r '.[] | select(.pull_request == null) | "#\(.number) \(.title) - \(.html_url)"' 2>/dev/null
        issue_count=$(echo "$response" | jq '[.[] | select(.pull_request == null)] | length' 2>/dev/null)
        if [ "$issue_count" = "0" ] || [ -z "$issue_count" ]; then
            echo "  No open issues."
        fi
        ;;

    list_prs)
        REPO="${2:-}"

        if [ -z "$REPO" ]; then
            echo "Usage: github list_prs <owner/repo>"
            echo "Error: repo is required."
            exit 1
        fi

        response=$(curl -s "$API/repos/$REPO/pulls?state=open&per_page=20" \
            -H "$AUTH_HEADER" \
            -H "Accept: application/vnd.github+json")

        echo "=== Open PRs on $REPO ==="
        echo "$response" | jq -r '.[] | "#\(.number) \(.title) [\(if .draft then "DRAFT" else "OPEN" end)] - \(.html_url)"' 2>/dev/null
        pr_count=$(echo "$response" | jq '. | length' 2>/dev/null)
        if [ "$pr_count" = "0" ] || [ -z "$pr_count" ]; then
            echo "  No open PRs."
        fi
        ;;

    *)
        echo "Unknown action: $ACTION"
        echo "Valid actions: issue, pr, fork, clone, comment_issue, list_issues, list_prs"
        exit 1
        ;;
esac
