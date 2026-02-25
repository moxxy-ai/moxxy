# Skill Management

Unified tool for managing agent skills. Use the first argument as the subcommand.

## Subcommands

### list
List all installed skills.
```
<invoke name="skill">["list"]</invoke>
```

### install
Install a skill from a URL or inline content.

From a moxxy skill URL:
```
<invoke name="skill">["install", "https://example.com/skills/my_tool"]</invoke>
```

From an openclaw-compatible URL:
```
<invoke name="skill">["install", "https://example.com/skill.md"]</invoke>
```

Inline (manifest, run.sh, skill.md):
```
<invoke name="skill">["install", "name = \"my_skill\"\ndescription = \"Does something\"\nversion = \"1.0.0\"", "#!/bin/sh\necho hello", "# My Skill"]</invoke>
```

### remove
Remove a custom skill by name:
```
<invoke name="skill">["remove", "skill_name"]</invoke>
```

### upgrade
Hot-swap an existing skill's code (version must be higher):
```
<invoke name="skill">["upgrade", "skill_name", "1.1.0", "<manifest_toml>", "<run_sh>", "<skill_md>"]</invoke>
```

### modify
Modify a single file in an existing skill:
```
<invoke name="skill">["modify", "skill_name", "run.sh", "#!/bin/sh\necho new code"]</invoke>
```

### create
LLM-generate a new skill from a name and description:
```
<invoke name="skill">["create", "my_new_skill", "A skill that does X"]</invoke>
```

### read
Read a skill's source files:
```
<invoke name="skill">["read", "skill_name"]</invoke>
```

### check
Scan skills for common problems (missing files, non-portable dependencies like jq, syntax issues):
```
<invoke name="skill">["check"]</invoke>
```

Check a specific skill:
```
<invoke name="skill">["check", "skill_name"]</invoke>
```

## Self-Check and Self-Repair

**When a skill fails**, follow this procedure:

1. **Run check** to identify the problem:
   ```
   <invoke name="skill">["check", "failing_skill_name"]</invoke>
   ```

2. **Read the skill source** to see the full code:
   ```
   <invoke name="skill">["read", "failing_skill_name"]</invoke>
   ```

3. **Fix the run.sh** by writing a corrected version:
   ```
   <invoke name="skill">["modify", "failing_skill_name", "run.sh", "#!/bin/sh\nset -eu\n... fixed code ..."]</invoke>
   ```

**Common fixes:**
- `jq: not found` → Replace all `jq` usage with `grep`/`sed`/`awk` (jq is NOT available on most systems)
- `command not found` → Replace the missing command with a portable alternative, do NOT try to install packages
- Skill must provide the ENTIRE new file content to `modify`, not just a diff

**Portable JSON patterns to use instead of jq:**
- Build JSON: `printf '{"key":"%s"}' "$(printf '%s' "$val" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')"`
- Check success: `printf '%s' "$resp" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'`
- Extract field: `printf '%s' "$resp" | sed -n 's/.*"field"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1`
