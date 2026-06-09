---
name: rebase-and-resolve
description: Rebase a feature branch onto latest main and resolve conflicts safely — use at task start, before final verify, and whenever main has moved.
---

# Rebase and resolve

Keep feature branches rebased onto latest main at task START and again BEFORE
the final verify/PR — requested changes regress otherwise.

```sh
git fetch origin
git rebase origin/main          # interactive -i is not available in this env
# per conflict: edit, git add <file>, git rebase --continue
```

After any rebase that moved main:

```sh
pnpm install    # only if pnpm-lock.yaml changed
pnpm build && pnpm test
```

## The TECH_DEBT.md hazard (learned the hard way)

`TECH_DEBT.md` is the one file where a stale merge silently LIES: PRs #113/#115
rebuilt it from a pre-#107/#108 base and resurrected two already-retired items.
Rules when it conflicts (or when editing it on a long-lived branch):

- **Rebase it against main FIRST, then re-apply your edits on top.** Never
  resolve by keeping your branch's whole-file version.
- **Keep the ✅ side.** If one side marks an item FIXED/retired and the other
  still lists it open, the ✅ side wins (verify against the code if unsure).
- Resolved entries move to the "Resolved ledger" — make sure the merge didn't
  drop ledger lines.

## Other conflict-prone files

- `pnpm-lock.yaml`: don't hand-merge — take MAIN's version (during a rebase
  that is `git checkout --ours pnpm-lock.yaml`; ours/theirs invert under
  rebase), then `pnpm install` regenerates your deps into it.
- `.changeset/*.md`: keep both sides' files; they're independent.
- `CHANGELOG.md` / `package.json` versions: take main's (changesets owns them).
