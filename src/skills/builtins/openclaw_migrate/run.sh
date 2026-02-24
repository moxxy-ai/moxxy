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
# AGENT_HOME is set by the skill executor (e.g. ~/.moxxy/agents/<name>)
# Derive the agents directory from it, falling back to ~/.moxxy/agents
if [ -n "$AGENT_HOME" ]; then
    MOXXY_DIR="$(dirname "$AGENT_HOME")"
else
    MOXXY_DIR="$HOME/.moxxy/agents"
fi

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
    
    # Build persona.md
    PERSONA_FILE="$TARGET_DIR/persona.md"
    echo "# Agent Persona" > "$PERSONA_FILE"
    echo "" >> "$PERSONA_FILE"
    echo "_Migrated from OpenClaw_" >> "$PERSONA_FILE"
    echo "" >> "$PERSONA_FILE"
    
    if [ -f "$OPENCLAW_DIR/SOUL.md" ]; then
        echo "## Core Identity (from SOUL.md)" >> "$PERSONA_FILE"
        echo "" >> "$PERSONA_FILE"
        cat "$OPENCLAW_DIR/SOUL.md" >> "$PERSONA_FILE"
        echo "" >> "$PERSONA_FILE"
        echo "Migrated: SOUL.md"
    fi
    
    if [ -f "$OPENCLAW_DIR/AGENTS.md" ]; then
        echo "## Workspace Guidelines (from AGENTS.md)" >> "$PERSONA_FILE"
        echo "" >> "$PERSONA_FILE"
        # Filter out tool-specific sections
        grep -v "^## Skills" "$OPENCLAW_DIR/AGENTS.md" | grep -v "^## Tools" >> "$PERSONA_FILE" 2>/dev/null || cat "$OPENCLAW_DIR/AGENTS.md" >> "$PERSONA_FILE"
        echo "" >> "$PERSONA_FILE"
        echo "Migrated: AGENTS.md"
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
    
    PERSONA_FILE="$TARGET_DIR/persona.md"
    echo "# Agent Persona" > "$PERSONA_FILE"
    echo "" >> "$PERSONA_FILE"
    echo "_Migrated from OpenClaw_" >> "$PERSONA_FILE"
    echo "" >> "$PERSONA_FILE"
    
    if [ -f "$OPENCLAW_DIR/SOUL.md" ]; then
        echo "## Core Identity (from SOUL.md)" >> "$PERSONA_FILE"
        echo "" >> "$PERSONA_FILE"
        cat "$OPENCLAW_DIR/SOUL.md" >> "$PERSONA_FILE"
        echo "" >> "$PERSONA_FILE"
    fi
    
    if [ -f "$OPENCLAW_DIR/AGENTS.md" ]; then
        echo "## Workspace Guidelines (from AGENTS.md)" >> "$PERSONA_FILE"
        echo "" >> "$PERSONA_FILE"
        cat "$OPENCLAW_DIR/AGENTS.md" >> "$PERSONA_FILE"
        echo "" >> "$PERSONA_FILE"
    fi
    
    echo "Persona migrated to: $PERSONA_FILE"
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
