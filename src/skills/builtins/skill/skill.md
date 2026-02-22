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
<invoke name="skill">["install", "https://moltbook.com/skill.md"]</invoke>
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
