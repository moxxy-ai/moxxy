# Modify Skill

Modifies a single file within an existing skill without replacing the entire skill.

## Usage

Provide 3 arguments:
1. Skill name (must already exist)
2. File to modify: `manifest.toml`, `skill.md`, or `run.sh`
3. The complete new content for that file

```
<invoke name="modify_skill">["city_info", "run.sh", "#!/bin/sh\ncurl -s \"https://api.example.com/city?q=$1&key=$GOOGLE_API_KEY\""]</invoke>
```

If you modify `manifest.toml`, the skill is automatically hot-reloaded in memory.
