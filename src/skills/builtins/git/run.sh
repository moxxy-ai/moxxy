#!/usr/bin/env bash

# Built-in Skill: git (local only)
# Passes all arguments directly to the native git binary.
# For GitHub API actions (issues, PRs, forks), use the "github" skill instead.

# Git identity from vault secrets (GIT_USER_NAME, GIT_USER_EMAIL)
export GIT_AUTHOR_NAME="${GIT_USER_NAME:-${AGENT_NAME:-MoxxyAgent}}"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_AUTHOR_EMAIL="${GIT_USER_EMAIL:-${AGENT_NAME:-agent}@moxxy.local}"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

if ! command -v git >/dev/null 2>&1; then
    echo "Error: 'git' is not installed on this system." >&2
    exit 1
fi

git "$@"
