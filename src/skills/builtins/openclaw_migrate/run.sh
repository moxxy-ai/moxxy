#!/bin/sh
# openclaw_migrate: Migrate OpenClaw configuration to Moxxy
#
# Subcommands:
#   check                     - Check if OpenClaw is installed
#   list                      - List migratable content
#   migrate <agent>           - Full migration to target agent
#   persona <agent>           - Migrate only persona files
#   skills <agent>            - Migrate only skills

OPENCLAW_DIR="$HOME/.openclaw/workspace"
OPENCLAW_ROOT="$HOME/.openclaw"
API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"
# AGENT_HOME is set by the skill executor (e.g. ~/.moxxy/agents/<name>)
# Derive the agents directory from it, falling back to ~/.moxxy/agents
if [ -n "$AGENT_HOME" ]; then
    MOXXY_DIR="$(dirname "$AGENT_HOME")"
else
    MOXXY_DIR="$HOME/.moxxy/agents"
fi

# Inline awk to transform OC persona for moxxy (strip OC-specific sections)
transform_persona() {
    awk '
    function normalize(s) {
        gsub(/^#+[[:space:]]*/, "", s);
        gsub(/[\x80-\xff]/, "", s);
        gsub(/[^a-zA-Z0-9 .()-]/, "", s);
        gsub(/[[:space:]]+/, " ", s);
        sub(/^[[:space:]]+/, "", s);
        sub(/[[:space:]]+$/, "", s);
        return tolower(s);
    }
    function matches_skip(norm) {
        if (index(norm, "first run") == 1) return 1;
        if (index(norm, "every session") == 1) return 1;
        if (norm == "memory") return 1;
        if (index(norm, "memory.md") >= 1) return 1;
        if (index(norm, "write it down") >= 1) return 1;
        if (index(norm, "heartbeats") >= 1) return 1;
        if (index(norm, "heartbeat vs cron") >= 1) return 1;
        if (index(norm, "memory maintenance") >= 1) return 1;
        if (index(norm, "know when to speak") >= 1) return 1;
        return 0;
    }
    {
        line = $0;
        heading_level = 0;
        if (match(line, /^#+/)) heading_level = RLENGTH;
        if (heading_level > 0) {
            if (skip) {
                if (heading_level <= skip_level) skip = 0;
                else { next; }
            }
            if (!skip) {
                norm = normalize(line);
                if (matches_skip(norm)) { skip = 1; skip_level = heading_level; next; }
            }
        }
        if (!skip) {
            gsub(/ \(from SOUL\.md\)/, "");
            gsub(/ \(from AGENTS\.md\)/, "");
            gsub(/^_Migrated from OpenClaw_$/, "");
            print;
        }
    }' "$@"
}

# Convert duration (30m, 1h) to 6-field cron
duration_to_cron() {
    case "$1" in
        0m|0h) echo "" ;;
        *m) n="${1%m}"; [ "$n" -gt 0 ] 2>/dev/null && echo "0 */$n * * * *" ;;
        *h) n="${1%h}"; [ "$n" -gt 0 ] 2>/dev/null && echo "0 0 */$n * * *" ;;
        *) echo "" ;;
    esac
}

# API call helper (uses internal token when available)
api_post() {
    if [ -n "$MOXXY_INTERNAL_TOKEN" ]; then
        curl -s -X POST -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" -H "Content-Type: application/json" -d "$2" "$1"
    else
        curl -s -X POST -H "Content-Type: application/json" -d "$2" "$1"
    fi
}

SUBCMD="$1"
shift 2>/dev/null

case "$SUBCMD" in

# ---- CHECK ----
check)
    if [ -d "$OPENCLAW_DIR" ]; then
        echo "OpenClaw detected at ~/.openclaw/workspace"
        echo ""
        [ -f "$OPENCLAW_DIR/SOUL.md" ] && echo "- SOUL.md: found" || echo "- SOUL.md: not found"
        [ -f "$OPENCLAW_DIR/AGENTS.md" ] && echo "- AGENTS.md: found" || echo "- AGENTS.md: not found"
        [ -f "$OPENCLAW_DIR/MEMORY.md" ] && echo "- MEMORY.md: found" || echo "- MEMORY.md: not found"
        
        SKILL_COUNT=$(find "$OPENCLAW_DIR/skills" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
        echo "- Skills: $SKILL_COUNT found"
        
        if [ -d "$OPENCLAW_DIR/memory" ]; then
            MEM_COUNT=$(find "$OPENCLAW_DIR/memory" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
            echo "- Daily memories: $MEM_COUNT found"
        fi
    else
        echo "OpenClaw installation not found at ~/.openclaw/workspace"
    fi
    ;;

# ---- LIST ----
list)
    if [ ! -d "$OPENCLAW_DIR" ]; then
        echo "OpenClaw installation not found"
        exit 1
    fi
    
    echo "=== Personas ==="
    [ -f "$OPENCLAW_DIR/SOUL.md" ] && echo "SOUL.md: $(wc -l < "$OPENCLAW_DIR/SOUL.md" | tr -d ' ') lines"
    [ -f "$OPENCLAW_DIR/AGENTS.md" ] && echo "AGENTS.md: $(wc -l < "$OPENCLAW_DIR/AGENTS.md" | tr -d ' ') lines"
    
    echo ""
    echo "=== Memory ==="
    [ -f "$OPENCLAW_DIR/MEMORY.md" ] && echo "MEMORY.md: $(wc -l < "$OPENCLAW_DIR/MEMORY.md" | tr -d ' ') lines"
    
    if [ -d "$OPENCLAW_DIR/memory" ]; then
        for f in "$OPENCLAW_DIR/memory"/*.md; do
            [ -f "$f" ] && echo "  $(basename "$f"): $(wc -l < "$f" | tr -d ' ') lines"
        done
    fi
    
    echo ""
    echo "=== Skills ==="
    for skill_dir in "$OPENCLAW_DIR/skills"/*/; do
        if [ -f "$skill_dir/SKILL.md" ]; then
            skill_name=$(basename "$skill_dir")
            echo "  $skill_name"
        fi
    done
    ;;

# ---- MIGRATE (full) ----
migrate)
    TARGET="$1"
    if [ -z "$TARGET" ]; then
        echo "Usage: openclaw_migrate migrate <target_agent>"
        exit 1
    fi
    
    if [ ! -d "$OPENCLAW_DIR" ]; then
        echo "OpenClaw installation not found"
        exit 1
    fi
    
    TARGET_DIR="$MOXXY_DIR/$TARGET"
    mkdir -p "$TARGET_DIR/skills"
    
    # Build persona.md (raw then transform)
    PERSONA_RAW=$(mktemp)
    trap "rm -f $PERSONA_RAW" EXIT
    {
        echo "# Agent Persona"
        echo ""
        if [ -f "$OPENCLAW_DIR/SOUL.md" ]; then
            echo "## Core Identity"
            echo ""
            cat "$OPENCLAW_DIR/SOUL.md"
            echo ""
        fi
        if [ -f "$OPENCLAW_DIR/AGENTS.md" ]; then
            echo "## Workspace Guidelines"
            echo ""
            grep -v "^## Skills" "$OPENCLAW_DIR/AGENTS.md" 2>/dev/null | grep -v "^## Tools" 2>/dev/null || cat "$OPENCLAW_DIR/AGENTS.md"
            echo ""
        fi
    } > "$PERSONA_RAW"
    transform_persona "$PERSONA_RAW" > "$TARGET_DIR/persona.md"
    
    # Heartbeat migration (if openclaw.json exists and python3 available)
    if [ -f "$OPENCLAW_ROOT/openclaw.json" ] && command -v python3 >/dev/null 2>&1; then
        HB_EVERY=$(python3 -c "
import json
with open('$OPENCLAW_ROOT/openclaw.json') as f:
    c = json.load(f)
v = c.get('agents',{}).get('defaults',{}).get('heartbeat',{}).get('every','')
if not v: v = c.get('heartbeat',{}).get('every','')
print(v)
" 2>/dev/null)
        if [ -n "$HB_EVERY" ]; then
            CRON=$(duration_to_cron "$HB_EVERY")
            if [ -n "$CRON" ]; then
                if [ -f "$OPENCLAW_DIR/HEARTBEAT.md" ]; then
                    HB_PROMPT=$(cat "$OPENCLAW_DIR/HEARTBEAT.md")
                else
                    HB_PROMPT="Proactively check for anything needing attention (inbox, calendar, notifications). If nothing needs attention, respond briefly."
                fi
                _esc_oc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }
                PAYLOAD=$(printf '{"name":"openclaw_heartbeat","cron":"%s","prompt":"%s"}' "$(_esc_oc "$CRON")" "$(_esc_oc "$HB_PROMPT")")
                resp=$(api_post "$API_BASE/agents/$TARGET/schedules" "$PAYLOAD")
                if echo "$resp" | grep -q '"success":true'; then
                    echo "Migrated: heartbeat -> scheduled job"
                fi
            fi
        fi
    fi
    
    # LLM migration (auth-profiles, vault, llm) - requires agent to exist in moxxy
    if [ -f "$OPENCLAW_ROOT/openclaw.json" ] && command -v python3 >/dev/null 2>&1; then
        for auth_file in "$OPENCLAW_ROOT"/agents/*/agent/auth-profiles.json; do
            [ -f "$auth_file" ] || continue
            python3 -c "
import json
with open('$auth_file') as f:
    data = json.load(f)
for name, p in data.get('profiles',{}).items():
    if p.get('type') == 'api_key':
        print(json.dumps({'key': p.get('provider','') + '_api_key', 'value': p.get('key','')}))
" 2>/dev/null | while read -r row; do
                [ -n "$row" ] && api_post "$API_BASE/agents/$TARGET/vault" "$row" >/dev/null 2>&1
            done
            break
        done
        PRIMARY=$(python3 -c "
import json
with open('$OPENCLAW_ROOT/openclaw.json') as f:
    c = json.load(f)
v = c.get('agent',{}).get('model',{}).get('primary','')
if not v: v = c.get('agents',{}).get('defaults',{}).get('model',{}).get('primary','')
print(v)
" 2>/dev/null)
        if [ -n "$PRIMARY" ]; then
            PROVIDER="${PRIMARY%%/*}"
            MODEL="${PRIMARY#*/}"
            resp=$(api_post "$API_BASE/agents/$TARGET/llm" "{\"provider\":\"$PROVIDER\",\"model\":\"$MODEL\"}")
            if echo "$resp" | grep -q '"success":true'; then
                echo "Migrated: LLM provider/model"
            fi
        fi
    fi
    
    # Migrate skills
    for skill_dir in "$OPENCLAW_DIR/skills"/*/; do
        if [ -f "$skill_dir/SKILL.md" ]; then
            skill_name=$(basename "$skill_dir")
            target_skill_dir="$TARGET_DIR/skills/$skill_name"
            mkdir -p "$target_skill_dir"
            
            # Extract frontmatter for manifest
            skill_md_content=$(cat "$skill_dir/SKILL.md")
            
            # Create manifest.toml
            cat > "$target_skill_dir/manifest.toml" << MANIFEST_EOF
name = "$skill_name"
description = "Migrated from OpenClaw"
version = "1.0.0"
executor_type = "openclaw"
needs_network = true
needs_fs_read = false
needs_fs_write = false
needs_env = false
entrypoint = "skill.md"
run_command = ""
MANIFEST_EOF
            
            # Create run.sh wrapper
            cat > "$target_skill_dir/run.sh" << 'RUN_EOF'
#!/bin/sh
echo "OpenClaw skill - see skill.md for documentation"
RUN_EOF
            chmod +x "$target_skill_dir/run.sh"
            
            # Copy skill.md
            cp "$skill_dir/SKILL.md" "$target_skill_dir/skill.md"
            
            echo "Migrated skill: $skill_name"
        fi
    done
    
    echo ""
    echo "Migration complete! Agent '$TARGET' created at:"
    echo "  $TARGET_DIR"
    ;;

# ---- PERSONA ----
persona)
    TARGET="$1"
    if [ -z "$TARGET" ]; then
        echo "Usage: openclaw_migrate persona <target_agent>"
        exit 1
    fi
    
    TARGET_DIR="$MOXXY_DIR/$TARGET"
    mkdir -p "$TARGET_DIR"
    
    PERSONA_RAW=$(mktemp)
    trap "rm -f $PERSONA_RAW" EXIT
    {
        echo "# Agent Persona"
        echo ""
        if [ -f "$OPENCLAW_DIR/SOUL.md" ]; then
            echo "## Core Identity"
            echo ""
            cat "$OPENCLAW_DIR/SOUL.md"
            echo ""
        fi
        if [ -f "$OPENCLAW_DIR/AGENTS.md" ]; then
            echo "## Workspace Guidelines"
            echo ""
            grep -v "^## Skills" "$OPENCLAW_DIR/AGENTS.md" 2>/dev/null | grep -v "^## Tools" 2>/dev/null || cat "$OPENCLAW_DIR/AGENTS.md"
            echo ""
        fi
    } > "$PERSONA_RAW"
    transform_persona "$PERSONA_RAW" > "$TARGET_DIR/persona.md"
    
    echo "Persona migrated to: $TARGET_DIR/persona.md"
    ;;

# ---- SKILLS ----
skills)
    TARGET="$1"
    if [ -z "$TARGET" ]; then
        echo "Usage: openclaw_migrate skills <target_agent>"
        exit 1
    fi
    
    TARGET_DIR="$MOXXY_DIR/$TARGET/skills"
    mkdir -p "$TARGET_DIR"
    
    for skill_dir in "$OPENCLAW_DIR/skills"/*/; do
        if [ -f "$skill_dir/SKILL.md" ]; then
            skill_name=$(basename "$skill_dir")
            target_skill_dir="$TARGET_DIR/$skill_name"
            mkdir -p "$target_skill_dir"
            
            cat > "$target_skill_dir/manifest.toml" << MANIFEST_EOF
name = "$skill_name"
description = "Migrated from OpenClaw"
version = "1.0.0"
executor_type = "openclaw"
needs_network = true
needs_fs_read = false
needs_fs_write = false
needs_env = false
entrypoint = "skill.md"
run_command = ""
MANIFEST_EOF
            
            cat > "$target_skill_dir/run.sh" << 'RUN_EOF'
#!/bin/sh
echo "OpenClaw skill - see skill.md for documentation"
RUN_EOF
            chmod +x "$target_skill_dir/run.sh"
            
            cp "$skill_dir/SKILL.md" "$target_skill_dir/skill.md"
            
            echo "Migrated: $skill_name"
        fi
    done
    
    echo "Skills migrated to: $TARGET_DIR"
    ;;

# ---- UNKNOWN ----
*)
    echo "Unknown subcommand: $SUBCMD"
    echo "Available: check, list, migrate, persona, skills"
    exit 1
    ;;

esac
