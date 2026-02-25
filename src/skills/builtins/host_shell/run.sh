#!/bin/sh

_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }

# Read command from CLI arg or stdin (for large payloads exceeding OS limits)
if [ -n "$1" ]; then
    CMD="$1"
elif [ "$MOXXY_ARGS_MODE" = "stdin" ]; then
    # Args arrive as a JSON array on stdin; extract the first string element
    raw_input=$(cat)
    CMD=$(printf '%s' "$raw_input" | sed 's/^\["//' | sed 's/"\]$//' | sed 's/\\"/"/g' | sed 's/\\\\/\\/g')
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
    JSON_PAYLOAD=$(printf '{"command":"%s","cwd":"%s"}' "$(_esc "$CMD")" "$(_esc "$AGENT_WORKSPACE")")
else
    JSON_PAYLOAD=$(printf '{"command":"%s"}' "$(_esc "$CMD")")
fi

curl -s -X POST -H "Content-Type: application/json" \
    -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" \
    -d "$JSON_PAYLOAD" \
    ${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/host/execute_bash
