---
name: rebase-and-resolve
description: Rebase a feature branch onto latest development and resolve conflicts safely — use at task start, before final verify, and whenever development has moved.
---

# Rebase and resolve

Keep feature branches rebased onto latest development at task START and again BEFORE
the final verify/PR — requested changes regress otherwise.

```sh
git fetch origin
git rebase origin/development   # interactive -i is not available in this env
# per conflict: edit, git add <file>, git rebase --continue
```

After any rebase that moved development:

```sh
pnpm install    # only if pnpm-lock.yaml changed
pnpm build && pnpm test
```

## Other conflict-prone files

- `pnpm-lock.yaml`: don't hand-merge — take MAIN's version (during a rebase
  that is `git checkout --ours pnpm-lock.yaml`; ours/theirs invert under
  rebase), then `pnpm install` regenerates your deps into it.
- `.changeset/*.md`: keep both sides' files; they're independent.
- `CHANGELOG.md` / `package.json` versions: take development's (changesets owns them).
