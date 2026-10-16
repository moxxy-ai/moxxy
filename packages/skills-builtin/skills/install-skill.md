---
name: install-skill
description: Install a ready-made skill from a link, a repo or `npx skills`, so it lands where Moxxy loads it and shows in Skills.
triggers: ["install skill", "add skill", "install this skill", "npx skills", "zainstaluj skill"]
allowed-tools: [Bash, Read, Glob, Write]
---
# Install a skill

Moxxy loads skills only from `~/.moxxy/skills/` (and `.moxxy/skills/` in the project).
Installers such as `npx skills add …` write elsewhere (`.agents/skills/`, `~/.claude/skills/`),
where Moxxy never looks.

1. Fetch the skill. With `npx skills add <source>`, note the folders it reports writing.
2. Copy each skill folder to `~/.moxxy/skills/<name>/` (keep `SKILL.md` and its reference files).
   Never overwrite an existing folder without asking.
3. Verify every copied `SKILL.md` before reporting success — read its frontmatter:
   - `name`: lowercase slug (`a-z`, `0-9`, `-`), at most 120 chars;
   - `description`: present, at most 1024 chars.
   A file failing either is skipped by Moxxy; say which and why.
4. Report only skills that passed, by name. New skills show in Skills and work from the next conversation.
