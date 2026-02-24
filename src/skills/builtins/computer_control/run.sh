#!/bin/sh
if [ -z "$1" ]; then
    echo "Usage: computer_control '<AppleScript Code>'"
    exit 1
fi

AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
    AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi

JSON_PAYLOAD=$(jq -n --arg script "$1" '{script: $script}')

curl -s -X POST ${AUTH_HEADER:+-H "$AUTH_HEADER"} -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD" \
    ${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/host/execute_applescript
