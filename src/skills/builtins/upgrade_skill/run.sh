#!/bin/sh
# upgrade_skill: Hot-swap an existing skill's code.
# Brain invokes: <invoke name="upgrade_skill">["skill_name", "new_version", "new_manifest_toml", "new_run_sh", "new_skill_md"]</invoke>
# Args: $1=skill_name, $2=new_version, $3=manifest_toml, $4=run_sh, $5=skill_md

if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ] || [ -z "$4" ]; then
    echo "Usage: upgrade_skill <skill_name> <new_version> <manifest_toml_content> <run_sh_content> [skill_md_content]"
    echo "All arguments are passed as separate positional parameters."
    exit 1
fi

SKILL_NAME="$1"
NEW_VERSION="$2"
NEW_MANIFEST="$3"
NEW_RUN_SH="$4"
NEW_SKILL_MD="${5:-# $SKILL_NAME}"

if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi

JSON_PAYLOAD=$(jq -n \
  --arg sn "$SKILL_NAME" \
  --arg nv "$NEW_VERSION" \
  --arg nm "$NEW_MANIFEST" \
  --arg rs "$NEW_RUN_SH" \
  --arg sd "$NEW_SKILL_MD" \
  '{skill_name: $sn, new_version_str: $nv, new_manifest_content: $nm, new_run_sh: $rs, new_skill_md: $sd}')

RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD" \
    "${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/${AGENT_NAME}/upgrade_skill")

echo "$RESPONSE"
