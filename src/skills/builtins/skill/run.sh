#!/bin/sh
# skill: Unified skill management tool.
#
# Subcommands:
#   list                                              - List all installed skills
#   install <url>                                     - Install from URL (moxxy or openclaw)
#   install <manifest_toml> <run_sh> [skill_md]       - Install inline
#   remove <skill_name>                               - Remove a custom skill
#   upgrade <skill_name> <ver> <manifest> <run_sh> [skill_md] - Upgrade a skill
#   modify <skill_name> <file_name> <content>         - Modify a skill file
#   create <skill_name> <description>                 - LLM-generate a new skill
#   read <skill_name>                                 - Read a skill's files

if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi

API="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"
SUBCMD="$1"
shift 2>/dev/null

case "$SUBCMD" in

# ---- LIST ----
list)
    curl -s "${API}/agents/${AGENT_NAME}/skills"
    ;;

# ---- INSTALL ----
install)
    if [ -z "$1" ]; then
        echo "Usage: skill install <url_or_manifest> [run_sh] [skill_md]"
        exit 1
    fi

    # If $2 is provided, it's inline mode
    if [ -n "$2" ]; then
        MANIFEST="$1"
        RUN_SH="$2"
        SKILL_MD="${3:-# Skill}"

        JSON_PAYLOAD=$(jq -n \
          --arg nm "$MANIFEST" \
          --arg rs "$RUN_SH" \
          --arg sd "$SKILL_MD" \
          '{new_manifest_content: $nm, new_run_sh: $rs, new_skill_md: $sd}')

        curl -s -X POST -H "Content-Type: application/json" \
            -H "X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}" \
            -d "$JSON_PAYLOAD" \
            "${API}/agents/${AGENT_NAME}/install_skill"
        exit 0
    fi

    # URL mode
    BASE_URL="$1"

    # Check if this is an openclaw skill URL
    IS_OPENCLAW=false
    if echo "$BASE_URL" | grep -qE '\.md$'; then
        IS_OPENCLAW=true
    else
        FIRST_LINE=$(curl -sf -r 0-3 "$BASE_URL" 2>/dev/null || echo "")
        if [ "$FIRST_LINE" = "---" ] || echo "$FIRST_LINE" | grep -q "^---"; then
            IS_OPENCLAW=true
        fi
    fi

    if [ "$IS_OPENCLAW" = "true" ]; then
        JSON_PAYLOAD=$(jq -n --arg url "$BASE_URL" '{url: $url}')
        curl -s -X POST -H "Content-Type: application/json" \
            -H "X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}" \
            -d "$JSON_PAYLOAD" \
            "${API}/agents/${AGENT_NAME}/install_openclaw_skill"
        exit 0
    fi

    # Standard moxxy skill URL
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

    curl -s -X POST -H "Content-Type: application/json" \
        -H "X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}" \
        -d "$JSON_PAYLOAD" \
        "${API}/agents/${AGENT_NAME}/install_skill"
    ;;

# ---- REMOVE ----
remove)
    if [ -z "$1" ]; then
        echo "Usage: skill remove <skill_name>"
        exit 1
    fi
    curl -s -X DELETE "${API}/agents/${AGENT_NAME}/skills/$1"
    ;;

# ---- UPGRADE ----
upgrade)
    if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ] || [ -z "$4" ]; then
        echo "Usage: skill upgrade <skill_name> <new_version> <manifest_toml> <run_sh> [skill_md]"
        exit 1
    fi
    SKILL_NAME="$1"
    NEW_VERSION="$2"
    NEW_MANIFEST="$3"
    NEW_RUN_SH="$4"
    NEW_SKILL_MD="${5:-# $SKILL_NAME}"

    JSON_PAYLOAD=$(jq -n \
      --arg sn "$SKILL_NAME" \
      --arg nv "$NEW_VERSION" \
      --arg nm "$NEW_MANIFEST" \
      --arg rs "$NEW_RUN_SH" \
      --arg sd "$NEW_SKILL_MD" \
      '{skill_name: $sn, new_version_str: $nv, new_manifest_content: $nm, new_run_sh: $rs, new_skill_md: $sd}')

    curl -s -X POST -H "Content-Type: application/json" \
        -d "$JSON_PAYLOAD" \
        "${API}/agents/${AGENT_NAME}/upgrade_skill"
    ;;

# ---- MODIFY ----
modify)
    if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
        echo "Usage: skill modify <skill_name> <file_name> <new_content>"
        exit 1
    fi
    SKILL_NAME="$1"
    FILE_NAME="$2"
    CONTENT="$3"

    JSON_PAYLOAD=$(jq -n \
      --arg sn "$SKILL_NAME" \
      --arg fn "$FILE_NAME" \
      --arg ct "$CONTENT" \
      '{skill_name: $sn, file_name: $fn, content: $ct}')

    curl -s -X PATCH -H "Content-Type: application/json" \
        -d "$JSON_PAYLOAD" \
        "${API}/agents/${AGENT_NAME}/skills/${SKILL_NAME}"
    ;;

# ---- CREATE ----
create)
    if [ -z "$1" ] || [ -z "$2" ]; then
        echo "Usage: skill create <skill_name> <description>"
        exit 1
    fi
    JSON_PAYLOAD=$(jq -n --arg name "$1" --arg desc "$2" '{name: $name, description: $desc}')

    RESULT=$(curl -s -X POST -H "Content-Type: application/json" \
        -d "$JSON_PAYLOAD" \
        "${API}/agents/${AGENT_NAME}/create_skill")

    if echo "$RESULT" | jq -e '.success == true' > /dev/null 2>&1; then
        echo "Skill '$1' created and registered successfully."
    else
        ERROR=$(echo "$RESULT" | jq -r '.error // "Unknown error"')
        echo "ERROR: Failed to create skill '$1': $ERROR"
        exit 1
    fi
    ;;

# ---- READ ----
read)
    if [ -z "$1" ]; then
        echo "Usage: skill read <skill_name>"
        exit 1
    fi
    SKILL_DIR="../$1"
    if [ ! -d "$SKILL_DIR" ]; then
        echo "Skill $1 does not exist."
        exit 1
    fi
    echo "--- manifest.toml ---"
    cat "$SKILL_DIR/manifest.toml"
    echo ""
    echo "--- skill.md ---"
    cat "$SKILL_DIR/skill.md"
    echo ""
    if [ -f "$SKILL_DIR/run.sh" ]; then
        echo "--- run.sh ---"
        cat "$SKILL_DIR/run.sh"
    fi
    ;;

# ---- UNKNOWN ----
*)
    echo "Unknown subcommand: $SUBCMD"
    echo "Available: list, install, remove, upgrade, modify, create, read"
    exit 1
    ;;
esac
