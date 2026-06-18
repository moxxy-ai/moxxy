---
"@moxxy/mode-collaborative": minor
"@moxxy/cli": patch
---

feat(collaborative): give every agent the whole goal + the conversation, not just its subtask

Spawned agents booted fresh sessions seeded with only their one-line subtask, so
they never saw the overall goal or the dialogue that produced it — and the
`MOXXY_COLLAB_PARENT_TASK` env the coordinator already set was read nowhere.

- The coordinator now distils the user's conversation into a compact, token-
  capped **`.moxxy-collab/BRIEF.md`** (goal + recent intent) and writes it into
  the scaffold before the architect runs, so it's committed into every worktree
  (parallel) or present in the shared dir (sequential) — the whole team inherits
  the real intent.
- `moxxy agent` now reads `MOXXY_COLLAB_PARENT_TASK` and seeds each implementer's
  first turn with the overall goal + its sub-task + a pointer to the brief and
  contracts (the architect, whose sub-task already is the goal, just gets the
  pointer).
- The shared agent prompt now tells every agent to read the brief first and to
  `recall()` prior knowledge + `memory_save` durable facts — so the team builds
  memory/recall for the larger work.

The brief is a pure, unit-tested digest (most-recent turns, clipped, total-
capped) so a long conversation still yields a small file.
