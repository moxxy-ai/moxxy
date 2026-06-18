---
"@moxxy/mode-collaborative": minor
"@moxxy/cli": patch
---

feat(collaborative): git-first execution with a parallel lock-coordinated fallback (invisible)

The non-git path ran agents ONE AT A TIME (sequential) — slow, and it's why "the
team doesn't respond" when a user runs in a plain folder (only one agent is ever
live). Now the engine is git-first and always parallel, and picks the safest
mechanism underneath without any user-facing jargon:

- **Already a git repo** → worktrees + a clean, conflict-aware merge (unchanged).
- **Plain folder** → we quietly `git init` + snapshot it, so it STILL gets full
  worktree isolation + merge. Most "plain folder" runs now go fully parallel.
- **Git genuinely unavailable** (not installed, or init/commit throws) → agents
  run in PARALLEL in the shared workspace, coordinated by the file-lock board
  (claim-before-edit). ownedPaths are pre-seeded as locks; an overlap is surfaced.
- **`concurrency: 'sequential'`** remains as the explicit one-at-a-time fallback.

Safety (from adversarial review): the shared-workspace prompt is hardened —
claim before EVERY edit, narrowest paths, claim both old+new on rename, one owner
for shared/aggregator files, only rely on a teammate's released work; the
architect is required to hand out DISJOINT ownedPaths. peer-read on the shared
tree reuses the path-traversal guard.

Tests: auto-init → git-parallel; forced no-git → cwd-parallel (not sequential, no
git repo); explicit sequential; cwd-parallel pre-seed + overlap surfacing.
