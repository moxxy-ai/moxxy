# Upgrade Skill

Hot-swaps the underlying code for an existing skill without requiring an engine restart.

## Usage

Provide 5 arguments as a JSON array:
1. Target skill name (must already exist)
2. New version string (must be strictly greater than current, e.g. "1.0.1")
3. New manifest.toml content (full TOML string)
4. New run.sh script content (full script string)
5. New skill.md documentation (optional, defaults to skill name)

```
<invoke name="upgrade_skill">["my_skill", "1.0.1", "name = \"my_skill\"\ndescription = \"Updated skill\"\nversion = \"1.0.1\"\nrun_command = \"sh\"\nentrypoint = \"run.sh\"", "#!/bin/sh\necho \"upgraded!\"", "# My Skill\nUpdated docs."]</invoke>
```
