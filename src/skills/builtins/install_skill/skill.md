# Install Skill

Installs a new skill into the agent's skill registry.

## Mode 1: Inline Creation

Provide the skill files directly as arguments:
1. manifest.toml content (full TOML)
2. run.sh script content
3. skill.md documentation (optional)

```
<invoke name="install_skill">["name = \"my_skill\"\ndescription = \"Does something\"\nversion = \"1.0.0\"\nrun_command = \"sh\"\nentrypoint = \"run.sh\"", "#!/bin/sh\necho \"Hello from my_skill: $1\"", "# My Skill\nA custom skill."]</invoke>
```

## Mode 2: URL Installation

Provide a base URL where the skill files are hosted:

```
<invoke name="install_skill">["https://example.com/skills/my_tool"]</invoke>
```

The engine will fetch manifest.toml, run.sh, and skill.md from that URL.
