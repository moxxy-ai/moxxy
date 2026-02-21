#!/bin/sh

AGENT_NAME="$1"
PROMPT="$2"

if [ -z "$AGENT_NAME" ] || [ -z "$PROMPT" ]; then
    echo "Error: Must provide both Target Agent Name and Prompt."
    exit 1
fi

# The container utilizes alpine's native curl and jq to parse the Control Plane JSON natively

# Securely dispatch the prompt over the host boundary into the Axum Control Plane
RESPONSE=$(curl -s -X POST -H "Content-Type: text/plain" -d "$PROMPT" "${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/$AGENT_NAME/delegate")

SUCCESS=$(echo "$RESPONSE" | jq -r '.success')

if [ "$SUCCESS" != "true" ]; then
    ERROR=$(echo "$RESPONSE" | jq -r '.error')
    echo "Delegation Failed: $ERROR"
    exit 1
fi

echo "$RESPONSE" | jq -r '.response'
