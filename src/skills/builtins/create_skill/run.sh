#!/bin/sh
# Args: $1=skill name, $2=description of what the skill should do
JSON_PAYLOAD=$(jq -n --arg name "$1" --arg desc "$2" '{name: $name, description: $desc}')

RESULT=$(curl -s -X POST -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD" \
    "${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/${AGENT_NAME}/create_skill")

if echo "$RESULT" | jq -e '.success == true' > /dev/null 2>&1; then
    echo "Skill '$1' created and registered successfully."
else
    ERROR=$(echo "$RESULT" | jq -r '.error // "Unknown error"')
    echo "ERROR: Failed to create skill '$1': $ERROR"
    exit 1
fi
