#!/bin/sh
# install_skill: Install a new skill either from a URL or inline content.
#
# Mode 1 - URL: install_skill <base_url>
#   Fetches manifest.toml, run.sh, skill.md from the URL.
#
# Mode 2 - Inline: install_skill <manifest_toml> <run_sh> [skill_md]
#   Creates the skill directly from provided content.

if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi

if [ -z "$1" ]; then
    echo "Usage:"
    echo "  install_skill <base_url>                           # Install from URL"
    echo "  install_skill <manifest_toml> <run_sh> [skill_md]  # Install inline"
    exit 1
fi

# Detect mode: if $2 is provided, it's inline mode
if [ -n "$2" ]; then
    # Inline mode: $1=manifest_toml, $2=run_sh, $3=skill_md (optional)
    MANIFEST="$1"
    RUN_SH="$2"
    SKILL_MD="${3:-# Skill}"

    JSON_PAYLOAD=$(jq -n \
      --arg nm "$MANIFEST" \
      --arg rs "$RUN_SH" \
      --arg sd "$SKILL_MD" \
      '{new_manifest_content: $nm, new_run_sh: $rs, new_skill_md: $sd}')
else
    # URL mode: $1=base_url
    BASE_URL="$1"

    echo "Fetching manifest.toml from ${BASE_URL}/manifest.toml..."
    MANIFEST=$(curl -sf "$BASE_URL/manifest.toml")
    if [ -z "$MANIFEST" ]; then echo "Error: Failed to fetch manifest.toml from $BASE_URL" && exit 1; fi

    echo "Fetching run.sh from ${BASE_URL}/run.sh..."
    RUN_SH=$(curl -sf "$BASE_URL/run.sh")
    if [ -z "$RUN_SH" ]; then echo "Error: Failed to fetch run.sh from $BASE_URL" && exit 1; fi

    echo "Fetching skill.md from ${BASE_URL}/skill.md..."
    SKILL_MD=$(curl -sf "$BASE_URL/skill.md" || echo "# Skill")

    JSON_PAYLOAD=$(jq -n \
      --arg nm "$MANIFEST" \
      --arg rs "$RUN_SH" \
      --arg sd "$SKILL_MD" \
      '{new_manifest_content: $nm, new_run_sh: $rs, new_skill_md: $sd}')
fi

RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD" \
    "${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/${AGENT_NAME}/install_skill")

echo "$RESPONSE"
