#!/bin/sh

# Read command from CLI arg or stdin (for large payloads exceeding OS limits)
if [ -n "$1" ]; then
    CMD="$1"
elif [ "$MOXXY_ARGS_MODE" = "stdin" ]; then
    # Args arrive as a JSON array on stdin, extract the first element
    CMD=$(cat | jq -r '.[0] // empty')
else
    echo "Usage: host_shell '<Bash Code>'"
    exit 1
fi

if [ -z "$CMD" ]; then
    echo "Error: empty command"
    exit 1
fi

# Build JSON payload with command and optional cwd (agent workspace)
if [ -n "$AGENT_WORKSPACE" ]; then
    printf '%s\n%s' "$CMD" "$AGENT_WORKSPACE" | jq -Rs 'split("\n") | {command: .[0], cwd: .[1]}' | \
        curl -s -X POST -H "Content-Type: application/json" \
        -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" \
        -d @- \
        ${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/host/execute_bash
else
    printf '%s' "$CMD" | jq -Rs '{command: .}' | \
        curl -s -X POST -H "Content-Type: application/json" \
        -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" \
        -d @- \
        ${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/host/execute_bash
fi
