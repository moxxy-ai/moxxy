#!/usr/bin/env bash

# Built-in Skill: github
# Interact with GitHub repositories via the REST API.
# Requires GITHUB_TOKEN in the vault.

GITHUB_API="https://api.github.com"
ACTION="${1:-}"

_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }
_jv() { v=$(printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1); printf '%s' "${v:-$3}"; }

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

        PAYLOAD=$(printf '{"title":"%s","body":"%s"}' "$(_esc "$TITLE")" "$(_esc "${BODY:-}")")

        response=$(curl -s -w "\n%{http_code}" -X POST "$GITHUB_API/repos/$REPO/issues" \
            -H "$AUTH_HEADER" \
            -H "Content-Type: application/json" \
            -H "Accept: application/vnd.github+json" \
            -d "$PAYLOAD")

        body=$(echo "$response" | sed '$d')
        status_code=$(echo "$response" | tail -n 1)

        if [ "$status_code" = "201" ]; then
            issue_url=$(_jv "$body" "html_url" "")
            issue_number=$(_jv "$body" "number" "")
            echo "Issue #$issue_number created: $issue_url"
        else
            echo "Failed (HTTP $status_code)."
            msg=$(_jv "$body" "message" "")
            echo "${msg:-$body}"
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
            fork_url=$(_jv "$body" "html_url" "")
            full_name=$(_jv "$body" "full_name" "")
            echo "Forked: $full_name - $fork_url"
        else
            echo "Failed (HTTP $status_code)."
            msg=$(_jv "$body" "message" "")
            echo "${msg:-$body}"
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
            if [ -n "${AGENT_WORKSPACE:-}" ]; then
                TARGET_DIR="${AGENT_WORKSPACE}/${REPO_NAME}"
            else
                TARGET_DIR="/tmp/git-${REPO_NAME}-$$"
            fi
        fi

        CLONE_URL="https://${GITHUB_TOKEN}@github.com/${REPO}.git"
        git clone "$CLONE_URL" "$TARGET_DIR" 2>&1

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

        PAYLOAD=$(printf '{"title":"%s","body":"%s","head":"%s","base":"%s","draft":true}' \
            "$(_esc "$TITLE")" "$(_esc "${DESCRIPTION:-}")" "$(_esc "$HEAD")" "$(_esc "$BASE")")

        response=$(curl -s -w "\n%{http_code}" -X POST "$GITHUB_API/repos/$REPO/pulls" \
            -H "$AUTH_HEADER" \
            -H "Content-Type: application/json" \
            -H "Accept: application/vnd.github+json" \
            -d "$PAYLOAD")

        body=$(echo "$response" | sed '$d')
        status_code=$(echo "$response" | tail -n 1)

        if [ "$status_code" = "201" ]; then
            pr_url=$(_jv "$body" "html_url" "")
            pr_number=$(_jv "$body" "number" "")
            echo "Draft PR #$pr_number created: $pr_url"
        else
            echo "Failed (HTTP $status_code)."
            msg=$(_jv "$body" "message" "")
            echo "${msg:-$body}"
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

        PAYLOAD=$(printf '{"body":"%s"}' "$(_esc "$COMMENT_BODY")")

        response=$(curl -s -w "\n%{http_code}" -X POST "$GITHUB_API/repos/$REPO/issues/$ISSUE_NUMBER/comments" \
            -H "$AUTH_HEADER" \
            -H "Content-Type: application/json" \
            -H "Accept: application/vnd.github+json" \
            -d "$PAYLOAD")

        body=$(echo "$response" | sed '$d')
        status_code=$(echo "$response" | tail -n 1)

        if [ "$status_code" = "201" ]; then
            comment_url=$(_jv "$body" "html_url" "")
            echo "Comment posted: $comment_url"
        else
            echo "Failed (HTTP $status_code)."
            msg=$(_jv "$body" "message" "")
            echo "${msg:-$body}"
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
        # Parse JSON array items; each issue has number, title, html_url
        # Filter out pull requests (they also appear in /issues)
        printf '%s' "$response" | grep -o '"number":[0-9]*,"title":"[^"]*"[^}]*"html_url":"[^"]*"' | while read -r item; do
            # Skip items that contain pull_request
            if printf '%s' "$item" | grep -q '"pull_request"'; then
                continue
            fi
            num=$(printf '%s' "$item" | sed -n 's/.*"number":\([0-9]*\).*/\1/p')
            title=$(printf '%s' "$item" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p')
            url=$(printf '%s' "$item" | sed -n 's/.*"html_url":"\([^"]*\)".*/\1/p')
            if [ -n "$num" ]; then
                echo "#$num $title - $url"
            fi
        done
        # Check if any were printed
        count=$(printf '%s' "$response" | grep -c '"number"' 2>/dev/null || true)
        if [ "$count" = "0" ] || [ -z "$count" ]; then
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
        # Parse each PR object for number, title, html_url, draft
        printf '%s' "$response" | grep -o '"number":[0-9]*' | sed 's/"number"://' | while read -r num; do
            title=$(printf '%s' "$response" | grep -o "\"number\":${num},\"title\":\"[^\"]*\"" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p' | head -1)
            url=$(printf '%s' "$response" | grep -o "\"number\":${num}[^}]*\"html_url\":\"[^\"]*\"" | sed -n 's/.*"html_url":"\([^"]*\)".*/\1/p' | head -1)
            draft=$(printf '%s' "$response" | grep -o "\"number\":${num}[^}]*\"draft\":[a-z]*" | sed -n 's/.*"draft":\([a-z]*\).*/\1/p' | head -1)
            status_label="OPEN"
            if [ "$draft" = "true" ]; then
                status_label="DRAFT"
            fi
            if [ -n "$num" ] && [ -n "$title" ]; then
                echo "#$num $title [$status_label] - $url"
            fi
        done
        count=$(printf '%s' "$response" | grep -c '"number"' 2>/dev/null || true)
        if [ "$count" = "0" ] || [ -z "$count" ]; then
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
