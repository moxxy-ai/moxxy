#!/usr/bin/env bash

# Built-in Skill: workspace_shell
# Workspace-locked shell: runs commands only within $AGENT_WORKSPACE
# Usage: workspace_shell <subdir> <command>
# Example: workspace_shell myrepo "npm install && npm run build"

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

TARGET="${AGENT_WORKSPACE}/${SUBDIR}"

# Security: resolve symlinks and verify we're still in workspace
RESOLVED=$(cd "$TARGET" 2>/dev/null && pwd -P)
if [ $? -ne 0 ]; then
    echo "Error: directory does not exist: $TARGET"
    exit 1
fi

WORKSPACE_RESOLVED=$(cd "$AGENT_WORKSPACE" && pwd -P)
case "$RESOLVED" in
    "$WORKSPACE_RESOLVED"*) ;; # OK - within workspace
    *)
        echo "Error: resolved path '$RESOLVED' is outside workspace"
        exit 1
        ;;
esac

cd "$TARGET" || exit 1
bash -c "$CMD" 2>&1
