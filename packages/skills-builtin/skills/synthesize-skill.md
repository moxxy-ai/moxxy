---
name: synthesize-skill
description: When the user request doesn't match any existing skill, draft a new one and persist it for next time.
triggers: ["create skill", "new skill", "save this as a skill"]
allowed-tools: [synthesize_skill, Write, Read]
---
# Synthesize a new skill

The user has asked for something for which no existing skill matches. Your job is to:

1. Identify the intent (one sentence).
2. **Prefer the `synthesize_skill` tool** — pass the intent and let it draft, validate
   the frontmatter against the canonical schema, pick a collision-free filename, persist
   to `~/.moxxy/skills/`, and hot-swap the registry. This is the path that can't ship
   invalid frontmatter or clobber an existing skill.
3. Only hand-write the file with `Write` if the tool is unavailable. If you do, the
   frontmatter MUST satisfy the schema (hard caps: `name` <=120, `description` <=240).
   Aim well under those for legibility — these are style budgets, not the wall:
   - `name`: kebab-case slug, aim for <=60 chars (schema hard cap 120)
   - `description`: one sentence, aim for <=120 chars (schema hard cap 240)
   - `triggers`: 2–5 short phrases a user might say
   - `allowed-tools`: only the tools you need
   The body is the instructions for future invocations: numbered steps, the minimum
   needed to execute reliably. Save to `~/.moxxy/skills/<slug>.md` unless the user
   redirects to project scope.

Keep skill bodies short — under 30 lines. Long context belongs in code/files the skill reads at runtime, not in the skill itself.
