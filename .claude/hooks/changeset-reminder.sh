#!/bin/sh
# PostToolUse hook (Edit|Write): one-line changeset reminder. ADVISORY ONLY —
# always exits 0, never blocks, prints at most one line.
#
# Purpose: every PR needs a `.changeset/*.md` (CI's "Changeset present" job
# fails without one). When a package/app source file is edited and the branch
# carries no changeset yet (vs origin/main, including untracked files), remind
# once per state — not per edit (a marker keyed on HEAD keeps it quiet).
#
# Cost (measured 2026-06-10): ~20-40 ms (a few git plumbing calls; jq if
# present, grep fallback otherwise; no pnpm, no network).

# --- extract the edited file path from the hook's stdin JSON ---------------
input=$(cat 2>/dev/null) || exit 0
if command -v jq >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  file=$(printf '%s' "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')
fi
[ -n "$file" ] || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# Only source under packages/* or apps/* counts as "shippable" change.
rel=${file#"$root"/}
case "$rel" in
  packages/*|apps/*) ;;
  *) exit 0 ;;
esac

# A changeset already on this branch (committed vs origin/main, staged, or
# untracked)? README.md is the template, not a changeset.
base=$(git merge-base origin/main HEAD 2>/dev/null) || base=""
committed=""
[ -n "$base" ] && committed=$(git diff --name-only --diff-filter=AM "$base"...HEAD -- '.changeset/*.md' 2>/dev/null | grep -v 'README\.md$')
pending=$(git status --porcelain '.changeset/*.md' 2>/dev/null | grep -v 'README\.md' )
[ -n "$committed$pending" ] && exit 0

# Remind once per HEAD, not on every edit. (Use --git-dir: in a linked
# worktree $root/.git is a pointer FILE, not a directory.)
gitdir=$(git rev-parse --absolute-git-dir 2>/dev/null) || exit 0
marker="$gitdir/moxxy-changeset-reminded"
head=$(git rev-parse HEAD 2>/dev/null)
[ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$head" ] && exit 0
printf '%s' "$head" > "$marker" 2>/dev/null

echo "Reminder: no .changeset/*.md on this branch yet — every PR needs one (hand-write it; empty '---/---' header for no-release changes). See .claude/skills/add-a-changeset/SKILL.md."
exit 0
