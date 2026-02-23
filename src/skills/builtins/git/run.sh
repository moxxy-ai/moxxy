#!/usr/bin/env bash

# Built-in Skill: git
# Execute local git commands OR interact with GitHub repositories via the API.
# GitHub actions (issue, pr, fork, etc.) use the GitHub REST API.
# All other arguments are passed directly to the git binary.

GITHUB_API="https://api.github.com"
ACTION="${1:-}"

# ---------- GitHub API actions ----------
# If the first argument matches a known GitHub action, route to the API.

require_github_token() {
    if [ -z "${GITHUB_TOKEN:-}" ]; then
        echo "Error: GITHUB_TOKEN is not set in your vault."
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
}

case "$ACTION" in
    issue|pr|fork|clone_repo|comment_issue|list_issues|list_prs)
        # All GitHub actions need a token
        require_github_token
        AUTH_HEADER="Authorization: Bearer $GITHUB_TOKEN"
        ;;
esac

case "$ACTION" in
    issue)
        REPO="${2:-}"
        TITLE="${3:-}"
        BODY="${4:-}"

        if [ -z "$REPO" ] || [ -z "$TITLE" ] || [ -z "$BODY" ]; then
            echo "Usage: git issue <owner/repo> <title> <body>"
            echo "Error: repo, title, and body are required."
            exit 1
        fi

        PAYLOAD=$(jq -n \
            --arg title "$TITLE" \
            --arg body "$BODY" \
            '{title: $title, body: $body}')

        response=$(curl -s -w "\n%{http_code}" -X POST "$GITHUB_API/repos/$REPO/issues" \
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
            echo "Usage: git fork <owner/repo>"
            echo "Error: repo is required."
            exit 1
        fi

        response=$(curl -s -w "\n%{http_code}" -X POST "$GITHUB_API/repos/$REPO/forks" \
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

    clone_repo)
        REPO="${2:-}"
        TARGET_DIR="${3:-}"

        if [ -z "$REPO" ]; then
            echo "Usage: git clone_repo <owner/repo> [target_directory]"
            echo "Error: repo is required."
            exit 1
        fi

        REPO_NAME=$(echo "$REPO" | cut -d'/' -f2)

        if [ -z "$TARGET_DIR" ]; then
            TARGET_DIR="/tmp/git-${REPO_NAME}-$$"
        fi

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
            echo "Usage: git pr <owner/repo> <title> <description> <head_user:branch> [base_branch]"
            echo "Error: repo, title, description, and head are required. base defaults to 'main'."
            exit 1
        fi

        PAYLOAD=$(jq -n \
            --arg title "$TITLE" \
            --arg body "$DESCRIPTION" \
            --arg head "$HEAD" \
            --arg base "$BASE" \
            '{title: $title, body: $body, head: $head, base: $base, draft: true}')

        response=$(curl -s -w "\n%{http_code}" -X POST "$GITHUB_API/repos/$REPO/pulls" \
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
            echo "Usage: git comment_issue <owner/repo> <issue_number> <body>"
            echo "Error: repo, issue_number, and body are required."
            exit 1
        fi

        PAYLOAD=$(jq -n --arg body "$COMMENT_BODY" '{body: $body}')

        response=$(curl -s -w "\n%{http_code}" -X POST "$GITHUB_API/repos/$REPO/issues/$ISSUE_NUMBER/comments" \
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
            echo "Usage: git list_issues <owner/repo>"
            echo "Error: repo is required."
            exit 1
        fi

        response=$(curl -s "$GITHUB_API/repos/$REPO/issues?state=open&per_page=20" \
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
            echo "Usage: git list_prs <owner/repo>"
            echo "Error: repo is required."
            exit 1
        fi

        response=$(curl -s "$GITHUB_API/repos/$REPO/pulls?state=open&per_page=20" \
            -H "$AUTH_HEADER" \
            -H "Accept: application/vnd.github+json")

        echo "=== Open PRs on $REPO ==="
        echo "$response" | jq -r '.[] | "#\(.number) \(.title) [\(if .draft then "DRAFT" else "OPEN" end)] - \(.html_url)"' 2>/dev/null
        pr_count=$(echo "$response" | jq '. | length' 2>/dev/null)
        if [ "$pr_count" = "0" ] || [ -z "$pr_count" ]; then
            echo "  No open PRs."
        fi
        ;;

    # ---------- Local git passthrough ----------
    *)
        if ! command -v git >/dev/null 2>&1; then
            # REST API fallback if git is not installed
            if command -v curl >/dev/null 2>&1; then
                API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"
                AGENT="${AGENT_NAME:-default}"

                ARGS_JSON="["
                FIRST=1
                for arg in "$@"; do
                    escaped_arg=$(echo "$arg" | sed 's/"/\\"/g')
                    if [ $FIRST -eq 1 ]; then
                        ARGS_JSON="$ARGS_JSON\"$escaped_arg\""
                        FIRST=0
                    else
                        ARGS_JSON="$ARGS_JSON, \"$escaped_arg\""
                    fi
                done
                ARGS_JSON="$ARGS_JSON]"

                RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/agents/$AGENT/git" \
                    -H "Content-Type: application/json" \
                    -d "{\"args\": $ARGS_JSON}")

                HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
                BODY=$(echo "$RESPONSE" | sed '$d')

                if [ "$HTTP_CODE" = "200" ]; then
                    echo "$BODY"
                    exit 0
                fi
            fi

            echo "Error: 'git' is not installed locally and the REST API fallback failed. Please install git." >&2
            exit 1
        fi

        git "$@"
        ;;
esac
