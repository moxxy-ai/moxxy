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
#   check [skill_name]                                - Check skills for common problems

if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi

API="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"
AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
    AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi
SUBCMD="$1"
shift 2>/dev/null

_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }
_jv() { v=$(printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1); printf '%s' "${v:-$3}"; }

# Check a single skill directory for common problems.
# Returns non-zero and prints diagnostics if issues found.
_check_skill() {
    skill_dir="$1"
    skill_name=$(basename "$skill_dir")
    issues=""

    if [ ! -f "$skill_dir/manifest.toml" ]; then
        issues="${issues}\n  - MISSING manifest.toml"
    fi

    run_file=""
    if [ -f "$skill_dir/run.sh" ]; then
        run_file="$skill_dir/run.sh"
    elif [ -f "$skill_dir/run.py" ]; then
        run_file="$skill_dir/run.py"
    else
        issues="${issues}\n  - MISSING entrypoint (run.sh or run.py)"
    fi

    if [ -n "$run_file" ]; then
        # Check for jq dependency (crashes on systems without it)
        if grep -q '\bjq\b' "$run_file" 2>/dev/null; then
            issues="${issues}\n  - USES jq (not portable, will crash on systems without it). Replace with grep/sed/awk."
        fi

        # Check for bash-only syntax in sh scripts
        first_line=$(head -1 "$run_file")
        if echo "$first_line" | grep -q '#!/bin/sh'; then
            if grep -qE '\[\[|\$\{[^}]*//|\$\{[^}]*%%|\$\{[^}]*##' "$run_file" 2>/dev/null; then
                issues="${issues}\n  - BASH syntax used but shebang is #!/bin/sh (use #!/bin/bash or fix syntax)"
            fi
        fi

        # Check for missing shebang
        if ! echo "$first_line" | grep -q '^#!'; then
            issues="${issues}\n  - MISSING shebang line (should start with #!/bin/sh)"
        fi
    fi

    if [ ! -f "$skill_dir/skill.md" ]; then
        issues="${issues}\n  - MISSING skill.md (LLM won't know how to use this skill)"
    fi

    if [ -n "$issues" ]; then
        printf "[FAIL] %s:%b\n" "$skill_name" "$issues"
        return 1
    else
        printf "[OK]   %s\n" "$skill_name"
        return 0
    fi
}

case "$SUBCMD" in

# ---- LIST ----
list)
    curl -s ${AUTH_HEADER:+-H "$AUTH_HEADER"} "${API}/agents/${AGENT_NAME}/skills"
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

        JSON_PAYLOAD=$(printf '{"new_manifest_content":"%s","new_run_sh":"%s","new_skill_md":"%s"}' \
          "$(_esc "$MANIFEST")" "$(_esc "$RUN_SH")" "$(_esc "$SKILL_MD")")

        curl -s -X POST -H "Content-Type: application/json" \
            ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
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
        JSON_PAYLOAD=$(printf '{"url":"%s"}' "$(_esc "$BASE_URL")")
        curl -s -X POST -H "Content-Type: application/json" \
            ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
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

    JSON_PAYLOAD=$(printf '{"new_manifest_content":"%s","new_run_sh":"%s","new_skill_md":"%s"}' \
      "$(_esc "$MANIFEST")" "$(_esc "$RUN_SH")" "$(_esc "$SKILL_MD")")

    curl -s -X POST -H "Content-Type: application/json" \
        ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
        -d "$JSON_PAYLOAD" \
        "${API}/agents/${AGENT_NAME}/install_skill"
    ;;

# ---- REMOVE ----
remove)
    if [ -z "$1" ]; then
        echo "Usage: skill remove <skill_name>"
        exit 1
    fi
    curl -s -X DELETE ${AUTH_HEADER:+-H "$AUTH_HEADER"} "${API}/agents/${AGENT_NAME}/skills/$1"
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

    JSON_PAYLOAD=$(printf '{"skill_name":"%s","new_version_str":"%s","new_manifest_content":"%s","new_run_sh":"%s","new_skill_md":"%s"}' \
      "$(_esc "$SKILL_NAME")" "$(_esc "$NEW_VERSION")" "$(_esc "$NEW_MANIFEST")" "$(_esc "$NEW_RUN_SH")" "$(_esc "$NEW_SKILL_MD")")

    curl -s -X POST -H "Content-Type: application/json" \
        ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
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

    JSON_PAYLOAD=$(printf '{"skill_name":"%s","file_name":"%s","content":"%s"}' \
      "$(_esc "$SKILL_NAME")" "$(_esc "$FILE_NAME")" "$(_esc "$CONTENT")")

    curl -s -X PATCH -H "Content-Type: application/json" \
        ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
        -d "$JSON_PAYLOAD" \
        "${API}/agents/${AGENT_NAME}/skills/${SKILL_NAME}"
    ;;

# ---- CREATE ----
create)
    if [ -z "$1" ] || [ -z "$2" ]; then
        echo "Usage: skill create <skill_name> <description>"
        exit 1
    fi
    JSON_PAYLOAD=$(printf '{"name":"%s","description":"%s"}' "$(_esc "$1")" "$(_esc "$2")")

    RESULT=$(curl -s -X POST -H "Content-Type: application/json" \
        ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
        -d "$JSON_PAYLOAD" \
        "${API}/agents/${AGENT_NAME}/create_skill")

    if printf '%s' "$RESULT" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
        echo "Skill '$1' created and registered successfully."
    else
        ERROR=$(_jv "$RESULT" "error" "Unknown error")
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

# ---- CHECK ----
check)
    TARGET="$1"
    SKILLS_BASE=".."
    total=0
    failed=0

    if [ -n "$TARGET" ]; then
        if [ ! -d "$SKILLS_BASE/$TARGET" ]; then
            echo "Skill '$TARGET' not found."
            exit 1
        fi
        _check_skill "$SKILLS_BASE/$TARGET"
        exit $?
    fi

    echo "Checking all skills for common problems..."
    echo ""
    for skill_dir in "$SKILLS_BASE"/*/; do
        [ -d "$skill_dir" ] || continue
        total=$((total + 1))
        if ! _check_skill "$skill_dir"; then
            failed=$((failed + 1))
        fi
    done
    echo ""
    echo "Checked $total skills: $((total - failed)) OK, $failed with issues."
    if [ "$failed" -gt 0 ]; then
        echo ""
        echo "To fix a skill: skill read <name>, then skill modify <name> run.sh '<fixed content>'"
        exit 1
    fi
    ;;

# ---- UNKNOWN ----
*)
    echo "Unknown subcommand: $SUBCMD"
    echo "Available: list, install, remove, upgrade, modify, create, read, check"
    exit 1
    ;;
esac
