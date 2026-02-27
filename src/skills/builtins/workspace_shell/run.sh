#!/usr/bin/env bash

# Built-in Skill: workspace_shell
# Workspace-locked shell: runs commands within $AGENT_WORKSPACE or active git worktree
# Usage: workspace_shell <subdir> <command>
# Example: workspace_shell myrepo "npm install && npm run build"

# Git identity from vault secrets (so git commands run here use proper credentials)
export GIT_AUTHOR_NAME="${GIT_USER_NAME:-${AGENT_NAME:-MoxxyAgent}}"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_AUTHOR_EMAIL="${GIT_USER_EMAIL:-${AGENT_NAME:-agent}@moxxy.local}"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

# Git HTTPS auth via GITHUB_TOKEN
if [ -n "${GITHUB_TOKEN:-}" ]; then
    _MOXXY_GIT_ASKPASS=$(mktemp)
    cat > "$_MOXXY_GIT_ASKPASS" <<'ASKPASS'
#!/bin/sh
echo "${GITHUB_TOKEN}"
ASKPASS
    chmod +x "$_MOXXY_GIT_ASKPASS"
    export GIT_ASKPASS="$_MOXXY_GIT_ASKPASS"
    export GIT_TERMINAL_PROMPT=0
    git config --global credential.https://github.com.username "x-access-token" 2>/dev/null || true
fi

SUBDIR="${1:-}"
CMD="${2:-}"

if [ -z "$CMD" ]; then
    echo "Usage: workspace_shell <subdir_within_workspace> <command>"
    echo "Example: workspace_shell myrepo \"npm install && npm run build\""
    exit 1
fi

if [ -z "$AGENT_WORKSPACE" ]; then
    echo "Error: AGENT_WORKSPACE is not set"
    exit 1
fi

# Check for active git worktree (set by git ws init/use)
ACTIVE_WT_FILE="${AGENT_WORKSPACE}/.moxxy-git/active-worktree"
WORKTREE_ROOT=""
if [ -f "$ACTIVE_WT_FILE" ]; then
    WORKTREE_ROOT=$(cat "$ACTIVE_WT_FILE" 2>/dev/null)
    [ -d "$WORKTREE_ROOT" ] || WORKTREE_ROOT=""
fi

# Resolve target directory:
# 1. If active worktree exists and subdir is "." or empty-ish, use worktree root
# 2. If active worktree exists and subdir is a subpath of it, use that
# 3. Fall back to AGENT_WORKSPACE/subdir
if [ -n "$WORKTREE_ROOT" ]; then
    if [ "$SUBDIR" = "." ] || [ "$SUBDIR" = "./" ] || [ -z "$SUBDIR" ]; then
        TARGET="$WORKTREE_ROOT"
    elif [ -d "${WORKTREE_ROOT}/${SUBDIR}" ]; then
        TARGET="${WORKTREE_ROOT}/${SUBDIR}"
    else
        TARGET="${AGENT_WORKSPACE}/${SUBDIR}"
    fi
else
    TARGET="${AGENT_WORKSPACE}/${SUBDIR}"
fi

# Security: resolve symlinks and verify we're within workspace or worktree
RESOLVED=$(cd "$TARGET" 2>/dev/null && pwd -P)
if [ $? -ne 0 ]; then
    echo "Error: directory does not exist: $TARGET"
    exit 1
fi

WORKSPACE_RESOLVED=$(cd "$AGENT_WORKSPACE" && pwd -P)
ALLOWED=false
case "$RESOLVED" in
    "$WORKSPACE_RESOLVED"*) ALLOWED=true ;;
esac
if [ -n "$WORKTREE_ROOT" ] && [ "$ALLOWED" = "false" ]; then
    WT_RESOLVED=$(cd "$WORKTREE_ROOT" 2>/dev/null && pwd -P)
    case "$RESOLVED" in
        "$WT_RESOLVED"*) ALLOWED=true ;;
    esac
fi

if [ "$ALLOWED" = "false" ]; then
    echo "Error: resolved path '$RESOLVED' is outside workspace and worktree"
    exit 1
fi

cd "$TARGET" || exit 1
bash -c "$CMD" 2>&1
