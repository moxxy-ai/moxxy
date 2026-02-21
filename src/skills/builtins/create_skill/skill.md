# create_skill

Use this skill when you need to teach yourself a new capability.
Provide 2 arguments:
1. `name`: The folder name for the skill (no spaces, lowercase with underscores).
2. `description`: A plain English description of what the skill should do.

The server will use an LLM to generate a valid `manifest.toml`, `skill.md`, and `run.sh` for you. The generated skill is validated and hot-registered immediately - no restart needed.
