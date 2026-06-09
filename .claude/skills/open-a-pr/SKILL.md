---
name: open-a-pr
description: Open a PR following this repo's conventions (worktree branch, changeset, title format, no AI attribution) — use when work is ready for review.
---

# Open a PR

Pre-flight, in order:

1. Work lives in a dedicated worktree under `.claude/worktrees/<name>` on its
   own branch — never commit on `main` directly.
2. Rebase onto latest `origin/main` (see rebase-and-resolve skill).
3. Run the full gate (see run-the-gate skill) — all green.
4. A `.changeset/*.md` exists (see add-a-changeset skill) — CI hard-fails
   without one.
5. TECH_DEBT.md: retire ≥1 item or log what you saw (see tech-debt-journal
   skill).

```sh
git push -u origin <branch>
gh pr create --title "<type>(<scope>): <summary>" --body "$(cat <<'EOF'
## What
...

## Why
...

## Verification
- pnpm build / typecheck / test / lint / check:deps green
- <manual verification if any>
EOF
)"
```

Conventions:
- **Title:** conventional-commit style, matching history — `fix(desktop): ...`,
  `feat(client): ...`, `chore(mobile): ...`, `docs(tech-debt): ...`,
  `refactor(modes): ...`. Check `git log --oneline -20` for the house style.
- **No AI attribution.** Never add `Co-Authored-By: Claude`, "Generated with
  Claude Code", or any robot footer to commits or PR bodies. The user is the
  sole author.
- **Squash-merge is the norm** — one PR squashes to one commit on main titled
  like the PR, so the PR title IS the future commit message. Make it carry the
  whole story.
- PR body says what was verified, not just what changed.
