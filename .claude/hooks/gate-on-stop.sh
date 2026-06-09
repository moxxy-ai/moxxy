#!/bin/sh
# Stop hook: don't let an agent declare "done" with a broken typecheck.
#
# Purpose: when the agent stops with uncommitted changes in a git worktree,
# run the turbo-cached `pnpm -w typecheck` and, on failure, block the stop
# (exit 2) with a short summary on stderr so the failure feeds back to the
# agent. Build/lint/test stay the agent's job (see the run-the-gate skill);
# this hook only catches the cheapest, highest-signal breakage.
#
# Cost (measured 2026-06-10 on this repo):
#   - clean tree / not a worktree / MOXXY_SKIP_GATE=1: ~10 ms (git calls only)
#   - dirty tree, warm turbo cache: ~0.3-5 s
#   - dirty tree, cold cache: up to ~60 s (hence the 180 s hook timeout)
#
# Escape hatch: MOXXY_SKIP_GATE=1 skips everything (use for docs-only stops
# or when iterating on intentionally-broken code).

[ "${MOXXY_SKIP_GATE:-}" = "1" ] && exit 0

# Not a git checkout at all -> nothing to gate.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Only gate LINKED worktrees (the repo convention is feature work in
# .claude/worktrees/<name>); in the main checkout, stay silent.
git_dir=$(git rev-parse --git-dir 2>/dev/null)
common_dir=$(git rev-parse --git-common-dir 2>/dev/null)
[ "$git_dir" = "$common_dir" ] && exit 0

# Clean tree -> the work (if any) is committed; trust CI from here.
[ -z "$(git status --porcelain 2>/dev/null)" ] && exit 0

out=$(pnpm -w typecheck 2>&1)
status=$?
[ "$status" -eq 0 ] && exit 0

{
  echo "Typecheck is broken in this worktree (pnpm -w typecheck, exit $status)."
  echo "Fix it before stopping. First errors:"
  # TS errors first; fall back to the tail if the failure isn't tsc-shaped.
  errs=$(printf '%s\n' "$out" | grep -E 'error TS[0-9]+|: error' | head -15)
  if [ -n "$errs" ]; then printf '%s\n' "$errs"; else printf '%s\n' "$out" | tail -15; fi
  echo "(escape hatch: MOXXY_SKIP_GATE=1)"
} >&2
exit 2
