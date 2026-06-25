---
---

chore: make `.ai/` the canonical catalog for AI-assistant skills + agents.

The 27 skills and 13 agent author-guides move from `.claude/` into a top-level
`.ai/` directory (single source of truth). `.claude/skills`, `.claude/agents`,
`.codex/skills`, `.codex/agents` become symlinks into `.ai/`, and AGENTS.md
points at `.ai/` so assistants don't duplicate or chase copies. Docs/tooling
only — no package is released.
