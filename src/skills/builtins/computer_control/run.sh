#!/bin/sh
if [ -z "$1" ]; then
    echo "Usage: computer_control '<AppleScript Code>'"
    exit 1
fi

AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
    AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi

_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }

JSON_PAYLOAD=$(printf '{"script":"%s"}' "$(_esc "$1")")

curl -s -X POST ${AUTH_HEADER:+-H "$AUTH_HEADER"} -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD" \
    ${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/host/execute_applescript
