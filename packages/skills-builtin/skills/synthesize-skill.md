---
name: synthesize-skill
description: When the user request doesn't match any existing skill, draft a new one and persist it for next time.
triggers: ["create skill", "new skill", "save this as a skill"]
allowed-tools: [Write, Read]
---
# Synthesize a new skill

The user has asked for something for which no existing skill matches. Your job is to:

1. Identify the intent (one sentence).
2. Draft a Markdown skill file with YAML frontmatter:
   - `name`: kebab-case slug, no more than 60 chars
   - `description`: one sentence, < 120 chars
   - `triggers`: 2–5 short phrases a user might say
   - `allowed-tools`: only the tools you need
3. The body is the instructions for future invocations: numbered steps, the minimum needed to execute reliably.
4. Save to `~/.moxxy/skills/<slug>.md` unless the user redirects to project scope.

Keep skill bodies short — under 30 lines. Long context belongs in code/files the skill reads at runtime, not in the skill itself.
