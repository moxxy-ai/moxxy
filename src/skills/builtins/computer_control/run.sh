#!/bin/sh
if [ -z "$1" ]; then
    echo "Usage: computer_control '<AppleScript Code>'"
    exit 1
fi

# Ensure curl and jq are installed quietly

# Send the script to the Host Proxy
JSON_PAYLOAD=$(jq -n --arg script "$1" '{script: $script}')

curl -s -X POST -H "Content-Type: application/json" \
    -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" \
    -d "$JSON_PAYLOAD" \
    ${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/host/execute_applescript
