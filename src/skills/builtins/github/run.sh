#!/usr/bin/env bash

# Built-in Skill: github
# Interact with GitHub repositories via the REST API.
# Requires GITHUB_TOKEN in the vault.

GITHUB_API="https://api.github.com"
ACTION="${1:-}"

require_github_token() {
    if [ -z "${GITHUB_TOKEN:-}" ]; then
        echo "Error: GITHUB_TOKEN is not set in your vault."
        echo ""
        echo "Set it via the vault skill:"
        echo '  <invoke name="manage_vault">["set", "GITHUB_TOKEN", "ghp_your_token_here"]</invoke>'
        echo ""
        echo "Create a token at https://github.com/settings/tokens (classic, with 'repo' scope)."
        exit 1
    fi
}

# Normalize common aliases
case "$ACTION" in
    create-issue|create_issue|create-issues) ACTION="issue" ;;
    create-pr|create_pr|pull-request|pull_request|open-pr) ACTION="pr" ;;
    clone|clone-repo|clone_repo) ACTION="clone" ;;
    comment|comment-issue|comment_issue) ACTION="comment" ;;
    list-issues|list_issues|issues) ACTION="list_issues" ;;
    list-prs|list_prs|prs|pulls) ACTION="list_prs" ;;
esac

require_github_token
AUTH_HEADER="Authorization: Bearer $GITHUB_TOKEN"

case "$ACTION" in
    issue)
        REPO="${2:-}"
        TITLE="${3:-}"
        BODY="${4:-}"

        if [ -z "$REPO" ] || [ -z "$TITLE" ]; then
            echo "Usage: github issue <owner/repo> <title> [body]"
            exit 1
        fi

        PAYLOAD=$(jq -n \
            --arg title "$TITLE" \
            --arg body "${BODY:-}" \
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
            echo "Issue #$issue_number created: $issue_url"
        else
            echo "Failed (HTTP $status_code)."
            echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body"
            exit 1
        fi
        ;;

    fork)
        REPO="${2:-}"

        if [ -z "$REPO" ]; then
            echo "Usage: github fork <owner/repo>"
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
            echo "Forked: $full_name - $fork_url"
        else
            echo "Failed (HTTP $status_code)."
            echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body"
            exit 1
        fi
        ;;

    clone)
        REPO="${2:-}"
        TARGET_DIR="${3:-}"

        if [ -z "$REPO" ]; then
            echo "Usage: github clone <owner/repo> [target_directory]"
            exit 1
        fi

        REPO_NAME=$(echo "$REPO" | cut -d'/' -f2)
        if [ -z "$TARGET_DIR" ]; then
            TARGET_DIR="/tmp/git-${REPO_NAME}-$$"
        fi

        CLONE_URL="https://${GITHUB_TOKEN}@github.com/${REPO}.git"
        git clone --depth 1 "$CLONE_URL" "$TARGET_DIR" 2>&1

        if [ $? -ne 0 ]; then
            echo "Failed to clone repository."
            exit 1
        fi

        echo "Cloned $REPO to $TARGET_DIR"
        ;;

    pr)
        REPO="${2:-}"
        TITLE="${3:-}"
        DESCRIPTION="${4:-}"
        HEAD="${5:-}"
        BASE="${6:-main}"

        if [ -z "$REPO" ] || [ -z "$TITLE" ] || [ -z "$HEAD" ]; then
            echo "Usage: github pr <owner/repo> <title> <description> <user:branch> [base]"
            exit 1
        fi

        PAYLOAD=$(jq -n \
            --arg title "$TITLE" \
            --arg body "${DESCRIPTION:-}" \
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
            echo "Draft PR #$pr_number created: $pr_url"
        else
            echo "Failed (HTTP $status_code)."
            echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body"
            exit 1
        fi
        ;;

    comment)
        REPO="${2:-}"
        ISSUE_NUMBER="${3:-}"
        COMMENT_BODY="${4:-}"

        if [ -z "$REPO" ] || [ -z "$ISSUE_NUMBER" ] || [ -z "$COMMENT_BODY" ]; then
            echo "Usage: github comment <owner/repo> <issue_number> <body>"
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
            echo "Comment posted: $comment_url"
        else
            echo "Failed (HTTP $status_code)."
            echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body"
            exit 1
        fi
        ;;

    list_issues)
        REPO="${2:-}"

        if [ -z "$REPO" ]; then
            echo "Usage: github list_issues <owner/repo>"
            exit 1
        fi

        response=$(curl -s "$GITHUB_API/repos/$REPO/issues?state=open&per_page=20" \
            -H "$AUTH_HEADER" \
            -H "Accept: application/vnd.github+json")

        echo "Open issues on $REPO:"
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
            exit 1
        fi

        response=$(curl -s "$GITHUB_API/repos/$REPO/pulls?state=open&per_page=20" \
            -H "$AUTH_HEADER" \
            -H "Accept: application/vnd.github+json")

        echo "Open PRs on $REPO:"
        echo "$response" | jq -r '.[] | "#\(.number) \(.title) [\(if .draft then "DRAFT" else "OPEN" end)] - \(.html_url)"' 2>/dev/null
        pr_count=$(echo "$response" | jq '. | length' 2>/dev/null)
        if [ "$pr_count" = "0" ] || [ -z "$pr_count" ]; then
            echo "  No open PRs."
        fi
        ;;

    *)
        echo "Unknown action: $ACTION"
        echo ""
        echo "Available actions: issue, pr, fork, clone, comment, list_issues, list_prs"
        echo "Example: github issue owner/repo \"Title\" \"Body\""
        exit 1
        ;;
esac
