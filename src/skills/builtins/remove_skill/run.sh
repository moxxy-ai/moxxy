#!/bin/sh
# remove_skill: Removes a custom skill by name.
# Brain invokes: <invoke name="remove_skill">["skill_name"]</invoke>

if [ -z "$1" ]; then
    echo "Usage: remove_skill <skill_name>"
    exit 1
fi

SKILL_NAME="$1"

if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi

RESPONSE=$(curl -s -X DELETE \
    "${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/${AGENT_NAME}/skills/${SKILL_NAME}")

echo "$RESPONSE"
