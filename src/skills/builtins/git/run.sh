#!/bin/sh

if ! command -v git >/dev/null 2>&1; then
    # Try REST API fallback if git is not available locally
    if command -v curl >/dev/null 2>&1; then
        API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"
        AGENT="${AGENT_NAME:-default}"
        
        # Construct simple JSON array for args
        ARGS_JSON="["
        FIRST=1
        for arg in "$@"; do
            # Escape double quotes minimally
            escaped_arg=$(echo "$arg" | sed 's/"/\\"/g')
            if [ $FIRST -eq 1 ]; then
                ARGS_JSON="$ARGS_JSON\"$escaped_arg\""
                FIRST=0
            else
                ARGS_JSON="$ARGS_JSON, \"$escaped_arg\""
            fi
        done
        ARGS_JSON="$ARGS_JSON]"
        
        # Execute REST API fallback
        RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/agents/$AGENT/git" \
            -H "Content-Type: application/json" \
            -d "{\"args\": $ARGS_JSON}")
        
        HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
        BODY=$(echo "$RESPONSE" | sed '$d')
        
        # If successful, output the result and exit
        if [ "$HTTP_CODE" = "200" ]; then
            echo "$BODY"
            exit 0
        fi
    fi

    # Fallback failed or curl is missing
    echo "Error: 'git' is not installed locally and the REST API fallback failed. Please install git to natively use this skill." >&2
    exit 1
fi

git "$@"
