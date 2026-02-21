#!/bin/sh
if [ -z "$1" ]; then
    echo "Usage: host_python '<Python Code>'"
    exit 1
fi


JSON_PAYLOAD=$(jq -n --arg code "$1" '{code: $code}')

# Try API with internal token authorization
if [ -n "$MOXXY_INTERNAL_TOKEN" ]; then
    RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
        -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" \
        -d "$JSON_PAYLOAD" \
        ${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/host/execute_python)
    SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
    if [ "$SUCCESS" = "true" ]; then
        echo "$RESPONSE" | jq -r '.output'
        exit 0
    fi
fi

# Fallback to local python3 if API fails or no token
python3 -c "$1"
