# Remove Skill

Removes a custom skill from the agent's registry and deletes its files from disk.

## Usage

```
<invoke name="remove_skill">["my_skill"]</invoke>
```

This will:
1. Remove the skill from the in-memory registry (immediately stops it from being invocable)
2. Delete the skill directory from disk

Note: Built-in skills (install_skill, upgrade_skill, remove_skill, list_skills, etc.) cannot be removed.
