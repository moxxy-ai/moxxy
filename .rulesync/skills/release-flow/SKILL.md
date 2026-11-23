---
name: release-flow
description: Understand/operate the release pipeline (one workflow on development → version → advance main → npm publish → desktop installers → self-update pickup) — use when shipping, debugging CI release jobs, or judging release impact.
---

# Release flow

Everything ships via changesets; there is no manual `npm version`/`publish`. ONE
workflow does it all: `.github/workflows/release.yml` runs **on `development`**
(daily `cron` 06:00 UTC + on-demand `workflow_dispatch`) and, in a single run:

1. **Version** — if changesets are pending on `development`, run `changeset
   version` (batches the day's changesets into ONE bump: package versions +
   changelogs, consumed changesets deleted), commit `chore: version packages
   [skip ci]`, push `development`. No pending changesets → skip (a catch-up /
   re-run still publishes + advances main below).
2. **Publish** — `scripts/safe-publish.mjs` (driven by `changesets/action`):
   - publishes non-private packages (`@moxxy/sdk`, `@moxxy/cli`) in **topo order
     over workspace deps**, skips versions already on npm, auto-bumps past
     tombstoned slots (committing those bumps to `development`), blocks dependents
     of a failed publish, post-verifies every `@moxxy/*` pin exists on the
     registry (A12). `--dry-run` prints the order. Idempotent → re-runs are safe.
   - Uses `pnpm publish` NEVER `npm publish` — npm ships `workspace:`/`catalog:`
     protocols verbatim → uninstallable tarball.
3. **Advance `main`** — make `main` exactly development's content as ONE clean
   `Release: v…` commit: `git commit-tree` builds a commit whose **tree** is
   development's and whose sole **parent** is `origin/main`, then fast-forwards
   `main`. It is a tree COPY, not a merge → no merge-base, no 3-way, **cannot
   conflict**. Skipped when `main` already equals `development`. This replaced the
   old `development → main` PR + `sync-back.yml`, which never fired (GitHub
   doesn't start workflows for `GITHUB_TOKEN` pushes → ancestry drift → recurring
   conflicts on every dev→main PR).
4. **Desktop** (when the bump changed `@moxxy/desktop`): the cut step only DECIDES
   version + pinned sha (guarded by `hasChangesets == 'false'` — reading the
   version mid-bump caused the desktop-v0.0.17 mismatched-artifacts incident, PR
   #85). Matrix builds (.dmg/.exe/.deb+AppImage) check out that sha; only after
   EVERY leg succeeds does `desktop-release` push the `desktop-v<version>` tag
   (**tag-after-build invariant** — a failed build must never burn the version,
   A22) and create a **DRAFT** GitHub Release.
5. **Human publishes the draft** → self-update goes live: the stager picks the
   semver-highest PUBLISHED `desktop-v*` release (drafts/prereleases skipped).
   Draft = no client updates, by design.

Operating notes:
- `main` is **publish-only + machine-advanced**: never push it, never PR into it,
  never feature-branch off it. `git log --first-parent main` = the release story.
- A `development → main` conflict is impossible because there is no such PR
  anymore. Version-file divergence just means the workflow hasn't advanced `main`
  yet — run the workflow (`workflow_dispatch`).
- Tier-1 bundle signing needs the `MOXXY_UPDATE_SIGNING_KEY` secret (Linux leg);
  absent (forks) the floor still ships, hot-update assets are skipped.
- A broken draft: do NOT publish; fix, re-run the workflow to re-cut, delete the
  bad draft + tag.
- npm publish needs the `NPM_TOKEN` secret; everything else works on
  `GITHUB_TOKEN` alone.
- Deeper: AGENTS.md → "Branching model" / "Releasing", docs/desktop-self-update.md,
  docs/desktop-code-signing.md.
