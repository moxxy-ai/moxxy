---
'@moxxy/sdk': patch
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Skills installed with `npx skills` now load: a skill description may be up to 1024 characters (was 240, which silently dropped most third-party skills). The desktop Skills view lists folder skills (`<name>/SKILL.md`) and shows why a skill cannot load, and a new built-in `install-skill` skill tells the agent to copy installed skills into `~/.moxxy/skills` and check them before reporting success.
