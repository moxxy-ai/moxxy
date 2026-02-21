#!/bin/sh
# modify_skill: Modifies a single file in an existing skill.
# Brain invokes: <invoke name="modify_skill">["skill_name", "file_name", "new_content"]</invoke>
# file_name must be: manifest.toml, skill.md, or run.sh

SKILL_NAME="$1"
FILE_NAME="$2"
CONTENT="$3"

if [ -z "$SKILL_NAME" ] || [ -z "$FILE_NAME" ] || [ -z "$CONTENT" ]; then
    echo "Usage: modify_skill <skill_name> <file_name> <new_content>"
    echo "  file_name: manifest.toml | skill.md | run.sh"
    exit 1
fi

if [ "$FILE_NAME" != "manifest.toml" ] && [ "$FILE_NAME" != "skill.md" ] && [ "$FILE_NAME" != "run.sh" ]; then
    echo "Error: file_name must be one of: manifest.toml, skill.md, or run.sh. Got: '$FILE_NAME'"
    exit 1
fi

if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi

# Use the web API to modify the skill file so in-memory registry stays in sync
JSON_PAYLOAD=$(jq -n \
  --arg sn "$SKILL_NAME" \
  --arg fn "$FILE_NAME" \
  --arg ct "$CONTENT" \
  '{skill_name: $sn, file_name: $fn, content: $ct}')

RESPONSE=$(curl -s -X PATCH -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD" \
    "${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/${AGENT_NAME}/skills/${SKILL_NAME}")

echo "$RESPONSE"
