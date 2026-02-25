#!/bin/sh
if [ -z "$1" ]; then
    echo "Usage: host_python '<Python Code>'"
    exit 1
fi

_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }

JSON_PAYLOAD=$(printf '{"code":"%s"}' "$(_esc "$1")")

# Try API with internal token authorization
if [ -n "$MOXXY_INTERNAL_TOKEN" ]; then
    RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
        -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" \
        -d "$JSON_PAYLOAD" \
        ${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/host/execute_python)
    SUCCESS=$(printf '%s' "$RESPONSE" | sed -n 's/.*"success"[[:space:]]*:[[:space:]]*\([a-z]*\).*/\1/p' | head -1)
    if [ "$SUCCESS" = "true" ]; then
        printf '%s' "$RESPONSE" | sed -n 's/.*"output"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
        exit 0
    fi
fi

# Fallback to local python3 if API fails or no token
python3 -c "$1"
