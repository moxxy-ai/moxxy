#!/bin/sh

AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
    AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi

AGENT_NAME="$1"
PROMPT="$2"

if [ -z "$AGENT_NAME" ] || [ -z "$PROMPT" ]; then
    echo "Error: Must provide both Target Agent Name and Prompt."
    exit 1
fi

RESPONSE=$(curl -s -X POST ${AUTH_HEADER:+-H "$AUTH_HEADER"} -H "Content-Type: text/plain" -d "$PROMPT" "${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/$AGENT_NAME/delegate")

if ! printf '%s' "$RESPONSE" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
    ERROR=$(printf '%s' "$RESPONSE" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    echo "Delegation Failed: ${ERROR:-unknown error}"
    exit 1
fi

printf '%s' "$RESPONSE" | sed -n 's/.*"response"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
