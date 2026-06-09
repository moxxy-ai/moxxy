# Claude Code hooks for this repo

Wired in `.claude/settings.json`. Design rule: **signal, not ceremony** — every
hook must be near-free on the paths that don't need it.

| Hook | Event | Cost | What it does |
|---|---|---|---|
| `gate-on-stop.sh` | Stop | ~10 ms clean / ~0.3–5 s dirty (warm turbo) | In a **linked worktree** with a **dirty tree**, runs `pnpm -w typecheck`; on failure blocks the stop (exit 2) with the first errors on stderr so the agent fixes before declaring done. Silent otherwise. Escape hatch: `MOXXY_SKIP_GATE=1`. |
| `changeset-reminder.sh` | PostToolUse (`Edit\|MultiEdit\|Write`) | ~20–40 ms | If the edited file is under `packages/*` or `apps/*` and the branch carries no `.changeset/*.md` vs `origin/main`, prints a one-line reminder (exit 0, advisory, once per HEAD). |

Build/lint/test stay manual — see `.claude/skills/run-the-gate/SKILL.md`.
Scripts are POSIX sh; deps: git + pnpm (+ jq if present, grep fallback).
