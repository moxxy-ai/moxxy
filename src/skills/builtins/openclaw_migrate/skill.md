# OpenClaw Migration

Migrate OpenClaw agents, personas (SOUL.md, AGENTS.md), and skills to Moxxy format.

## When to Use

Use this skill when the user mentions:
- "I want to migrate from OpenClaw"
- "Import my OpenClaw config"
- "Move my OpenClaw agent to Moxxy"
- "Convert my OpenClaw skills"

## Usage

### Check if OpenClaw is installed
```
<invoke name="openclaw_migrate">["check"]</invoke>
```
Returns whether OpenClaw installation is detected and what content can be migrated.

### List migratable content
```
<invoke name="openclaw_migrate">["list"]</invoke>
```
Returns a list of personas, skills, and memory files found.

### Migrate everything to a target agent
```
<invoke name="openclaw_migrate">["migrate", "<target_agent_name>"]</invoke>
```
Performs full migration:
- SOUL.md + AGENTS.md → persona.md
- MEMORY.md + daily memories → STM database
- SKILL.md files → Moxxy skill format

### Migrate only persona
```
<invoke name="openclaw_migrate">["persona", "<target_agent_name>"]</invoke>
```
Migrates only SOUL.md and AGENTS.md to persona.md.

### Migrate only skills
```
<invoke name="openclaw_migrate">["skills", "<target_agent_name>"]</invoke>
```
Migrates all OpenClaw skills to Moxxy format.

## Example

```
User: I want to migrate my OpenClaw config into moxxy

Agent: I'll help you migrate from OpenClaw. Let me first check your installation.

<invoke name="openclaw_migrate">["check"]</invoke>

Result: OpenClaw detected at ~/.openclaw/workspace
- SOUL.md: found
- AGENTS.md: found  
- MEMORY.md: found
- Skills: 5 found

Agent: I found your OpenClaw configuration. I'll migrate everything to your Moxxy agent.

<invoke name="openclaw_migrate">["migrate", "default"]</invoke>
```

## Migration Details

### Persona Conversion
- SOUL.md content is preserved as the core identity section
- AGENTS.md is filtered (tool-specific sections removed) and added as workspace guidelines
- Combined into a single persona.md file

### Skills Conversion
OpenClaw skills (SKILL.md with YAML frontmatter) are converted to Moxxy format:
- manifest.toml - Skill metadata
- run.sh - Execution wrapper
- skill.md - Documentation (preserved from SKILL.md)

Skills use `executor_type = "openclaw"` so they work as documentation-only skills.

### Memory Import
- MEMORY.md is imported to short-term memory
- Daily memory files (memory/*.md) are also imported
- All entries are tagged with session_id "migrated"
