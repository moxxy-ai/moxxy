#!/usr/bin/env bash

# Built-in Skill: contribute
# Suggest features or contribute code to the moxxy project via GitHub.

REPO="moxxy-ai/moxxy"
API="https://api.github.com"

ACTION=$1

if [ -z "$ACTION" ]; then
    echo "Usage: contribute <action> [arguments...]"
    echo "Actions: suggest, implement, status"
    echo "Error: Missing action."
    exit 1
fi

# Check for GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN is not set in your vault."
    echo ""
    echo "To use the contribute skill, you need a GitHub Personal Access Token."
    echo ""
    echo "Option 1 — Set it via the web dashboard:"
    echo "  Go to the Vault tab → Add a secret with the exact name: GITHUB_TOKEN"
    echo ""
    echo "Option 2 — Set it via the vault skill:"
    echo '  <invoke name="manage_vault">["set", "GITHUB_TOKEN", "ghp_your_token_here"]</invoke>'
    echo ""
    echo "How to create a token:"
    echo "  1. Go to https://github.com/settings/tokens"
    echo "  2. Generate a new token (classic) with 'repo' and 'public_repo' scopes"
    echo "  3. Copy the token and store it using one of the options above"
    echo ""
    echo "Please provide your GitHub token or create one, then store it as GITHUB_TOKEN in the vault."
    exit 1
fi

AUTH_HEADER="Authorization: Bearer $GITHUB_TOKEN"

case "$ACTION" in
    suggest)
        TITLE=$2
        BODY=$3

        if [ -z "$TITLE" ] || [ -z "$BODY" ]; then
            echo "Usage: contribute suggest <title> <body>"
            echo "Error: Both title and body are required."
            exit 1
        fi

        PAYLOAD=$(jq -n \
            --arg title "$TITLE" \
            --arg body "$BODY" \
            '{title: $title, body: ("🤖 *This issue was suggested by a moxxy agent.*\n\n" + $body + "\n\n---\n*Submitted via the moxxy `contribute` skill*")}')

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

    implement)
        TITLE=$2
        DESCRIPTION=$3
        BRANCH_NAME=$4

        if [ -z "$TITLE" ] || [ -z "$DESCRIPTION" ] || [ -z "$BRANCH_NAME" ]; then
            echo "Usage: contribute implement <title> <description> <branch_name>"
            echo ""
            echo "This will:"
            echo "  1. Fork moxxy-ai/moxxy to your GitHub account (if not already forked)"
            echo "  2. Clone your fork locally"
            echo "  3. Create a branch for your changes"
            echo "  4. You then make changes and commit them"
            echo "  5. Push and open a draft PR against the upstream repo"
            echo ""
            echo "Error: title, description, and branch_name are required."
            exit 1
        fi

        # Step 1: Get authenticated user
        user_response=$(curl -s -w "\n%{http_code}" -X GET "$API/user" \
            -H "$AUTH_HEADER" \
            -H "Accept: application/vnd.github+json")
        user_body=$(echo "$user_response" | sed '$d')
        user_status=$(echo "$user_response" | tail -n 1)

        if [ "$user_status" != "200" ]; then
            echo "Failed to authenticate with GitHub. Check your GITHUB_TOKEN."
            exit 1
        fi

        GITHUB_USER=$(echo "$user_body" | jq -r '.login')
        echo "Authenticated as: $GITHUB_USER"

        # Step 2: Fork the repo (idempotent — GitHub returns existing fork if one exists)
        echo "Ensuring fork exists..."
        fork_response=$(curl -s -w "\n%{http_code}" -X POST "$API/repos/$REPO/forks" \
            -H "$AUTH_HEADER" \
            -H "Accept: application/vnd.github+json" \
            -d '{}')
        fork_body=$(echo "$fork_response" | sed '$d')
        fork_status=$(echo "$fork_response" | tail -n 1)

        if [ "$fork_status" != "202" ] && [ "$fork_status" != "200" ]; then
            echo "Failed to fork repository (HTTP $fork_status)."
            echo "$fork_body" | jq -r '.message // .' 2>/dev/null || echo "$fork_body"
            exit 1
        fi

        FORK_URL=$(echo "$fork_body" | jq -r '.clone_url // empty')
        if [ -z "$FORK_URL" ]; then
            FORK_URL="https://github.com/$GITHUB_USER/moxxy.git"
        fi
        echo "Fork ready: $FORK_URL"

        # Step 3: Clone fork and create branch
        WORK_DIR="/tmp/moxxy-contribute-$$"
        echo "Cloning fork to $WORK_DIR ..."

        git clone --depth 1 "$FORK_URL" "$WORK_DIR" 2>&1
        if [ $? -ne 0 ]; then
            echo "Failed to clone fork."
            exit 1
        fi

        cd "$WORK_DIR"
        git remote add upstream "https://github.com/$REPO.git" 2>/dev/null
        git checkout -b "$BRANCH_NAME"

        echo ""
        echo "=== Ready for implementation ==="
        echo "Working directory: $WORK_DIR"
        echo "Branch: $BRANCH_NAME"
        echo ""
        echo "Next steps:"
        echo "  1. Make your changes in $WORK_DIR"
        echo "  2. Commit your changes using the git skill"
        echo "  3. Then run: contribute submit \"$TITLE\" \"$DESCRIPTION\" \"$BRANCH_NAME\""
        echo ""
        echo "Tip: Use host_shell to navigate to $WORK_DIR and make changes."
        ;;

    submit)
        TITLE=$2
        DESCRIPTION=$3
        BRANCH_NAME=$4
        WORK_DIR=$5

        if [ -z "$TITLE" ] || [ -z "$DESCRIPTION" ] || [ -z "$BRANCH_NAME" ]; then
            echo "Usage: contribute submit <title> <description> <branch_name> [work_dir]"
            echo "Error: title, description, and branch_name are required."
            exit 1
        fi

        if [ -z "$WORK_DIR" ]; then
            # Try to find the most recent contribute work dir
            WORK_DIR=$(ls -dt /tmp/moxxy-contribute-* 2>/dev/null | head -1)
        fi

        if [ -z "$WORK_DIR" ] || [ ! -d "$WORK_DIR" ]; then
            echo "Error: Working directory not found. Run 'contribute implement' first."
            exit 1
        fi

        # Get authenticated user
        user_response=$(curl -s "$API/user" -H "$AUTH_HEADER" -H "Accept: application/vnd.github+json")
        GITHUB_USER=$(echo "$user_response" | jq -r '.login')

        cd "$WORK_DIR"

        # Push the branch
        echo "Pushing branch $BRANCH_NAME ..."
        git push origin "$BRANCH_NAME" 2>&1
        if [ $? -ne 0 ]; then
            echo "Failed to push branch. Make sure you have committed your changes."
            exit 1
        fi

        # Create draft PR
        PR_BODY="🤖 *This PR was drafted by a moxxy agent.*

## Description

$DESCRIPTION

---
*Submitted via the moxxy \`contribute\` skill*"

        PAYLOAD=$(jq -n \
            --arg title "$TITLE" \
            --arg body "$PR_BODY" \
            --arg head "$GITHUB_USER:$BRANCH_NAME" \
            --arg base "main" \
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
            echo ""
            echo "The PR is opened as a draft. A maintainer will review it."
        else
            echo "Failed to create PR (HTTP $status_code)."
            echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body"
            exit 1
        fi
        ;;

    status)
        # Get authenticated user
        user_response=$(curl -s "$API/user" -H "$AUTH_HEADER" -H "Accept: application/vnd.github+json")
        GITHUB_USER=$(echo "$user_response" | jq -r '.login')

        echo "=== Your issues on $REPO ==="
        issues_response=$(curl -s "$API/repos/$REPO/issues?creator=$GITHUB_USER&state=open" \
            -H "$AUTH_HEADER" \
            -H "Accept: application/vnd.github+json")

        echo "$issues_response" | jq -r '.[] | select(.pull_request == null) | "#\(.number) \(.title) (\(.state)) — \(.html_url)"' 2>/dev/null
        issue_count=$(echo "$issues_response" | jq '[.[] | select(.pull_request == null)] | length' 2>/dev/null)
        if [ "$issue_count" = "0" ] || [ -z "$issue_count" ]; then
            echo "  No open issues."
        fi

        echo ""
        echo "=== Your PRs on $REPO ==="
        prs_response=$(curl -s "$API/repos/$REPO/pulls?state=open" \
            -H "$AUTH_HEADER" \
            -H "Accept: application/vnd.github+json")

        echo "$prs_response" | jq -r --arg user "$GITHUB_USER" '.[] | select(.user.login == $user) | "#\(.number) \(.title) [\(if .draft then "DRAFT" else "OPEN" end)] — \(.html_url)"' 2>/dev/null
        pr_count=$(echo "$prs_response" | jq --arg user "$GITHUB_USER" '[.[] | select(.user.login == $user)] | length' 2>/dev/null)
        if [ "$pr_count" = "0" ] || [ -z "$pr_count" ]; then
            echo "  No open PRs."
        fi
        ;;

    *)
        echo "Unknown action: $ACTION"
        echo "Valid actions: suggest, implement, submit, status"
        exit 1
        ;;
esac
