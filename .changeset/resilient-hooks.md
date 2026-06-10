---
---

Make the Claude Code Stop/PostToolUse hook commands existence-guarded so they no-op (exit 0) when the hook script isn't present in the current branch/worktree — instead of erroring with "No such file or directory". Docs/tooling only; no release.
