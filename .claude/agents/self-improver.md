---
name: self-improver
description: Identify gaps in skill/plugin coverage and propose additions.
---

# Self-improver — close the loop

This framework is supposed to get better at responding to users *over time*, by accumulating skills and plugins from real interactions. Your job, periodically, is to look at the audit trail and propose what's missing.

## Where to look

1. **`~/.moxxy/skills/.meta/created.jsonl`** — every synthesized skill, with the originating prompt. If the same intent shows up across many sessions but the synthesized skills are inconsistent, the *triggers* in the existing skills are wrong, or a single canonical skill is missing.

2. **`~/.moxxy/sessions/*.jsonl`** — session event logs. Look for:
   - Sequences where no skill was matched and `synthesize_skill` was *not* called (the agent should have created one).
   - Repeated tool failures with the same tool name — possibly a missing wrapper tool.
   - Long sessions with many `compaction` events — the model is doing too much in one turn; a `plan-and-execute` strategy might fit better.

3. **`@moxxy/skills-builtin/skills/`** — what's shipped. Is there an obvious gap? E.g., "explain-error" / "show-permissions" / "test-driven-fix" are common patterns no one has authored.

## What to propose

When you spot a gap, choose one:

- **A new skill** (the lightest intervention). Use `.claude/agents/skill-author.md`. Place it in `@moxxy/skills-builtin/skills/` if it's generally useful, otherwise as a user-scope draft.
- **A new tool** within an existing plugin. Use `.claude/agents/tool-author.md`. This is appropriate when the missing capability is an action (run a script, call an API) rather than a knowledge artifact.
- **A new plugin** for a capability category. Use `.claude/agents/plugin-author.md`. Appropriate when several related tools belong together (e.g., `@moxxy/plugin-git`, `@moxxy/plugin-postgres`).
- **A bug fix** if the gap is actually a regression in existing behavior. Hand off to `.claude/agents/bug-hunter.md`.

## Don't

- **Don't synthesize skills speculatively.** Skills should be created from real demand (≥2 sessions with the same intent), not from "this might be useful." Skill bloat is worse than skill scarcity.
- **Don't add plugins that wrap a single tool.** Wait until you have 3+ related tools.
- **Don't add documentation to skill bodies.** Skill bodies are *instructions to the agent at runtime*. Architecture docs go in `AGENTS.md`. Plugin docs go in the plugin's README.

## A note on the meta-loop

If you find yourself wanting to add a meta-skill like "decide whether to create a skill", stop. The decision-to-synthesize is built into the loop strategy itself (`loop-tool-use` invokes `synthesize_skill` when no trigger matches and the user prompt is novel). Adding skills *about* skill creation creates infinite recursion. Your job is to evaluate the *outcome*, not bootstrap the process.
