---
name: release-flow
description: Understand/operate the release pipeline (changesets → Version PR → npm publish → desktop installers → self-update pickup) — use when shipping, debugging CI release jobs, or judging release impact.
---

# Release flow

Everything ships via changesets; there is no manual `npm version`/`publish`.
Pipeline (`.github/workflows/release.yml`):

1. **PR merges to main with changesets** → `changesets/action` opens/updates
   the **"Version Packages" PR** (bumps versions, writes changelogs, deletes
   consumed changesets).
2. **Version PR merges** → same workflow re-runs with no pending changesets →
   publishes via `scripts/safe-publish.mjs`:
   - publishes non-private packages (`@moxxy/sdk`, `@moxxy/cli`) in **topo
     order over workspace deps**, skips versions already on npm, auto-bumps
     past tombstoned slots (committing those bumps back to main), blocks
     dependents of a failed publish, post-verifies every `@moxxy/*` pin
     exists on the registry (A12). `--dry-run` prints the order.
   - Uses `pnpm publish` NEVER `npm publish` — npm ships `workspace:`/
     `catalog:` protocols verbatim → uninstallable tarball.
3. **Desktop** (when the merged Version PR bumped `@moxxy/desktop`): the cut
   step only DECIDES version + pinned sha (guarded by
   `hasChangesets == 'false'` — reading the version mid-bump caused the
   desktop-v0.0.17 mismatched-artifacts incident, PR #85). Matrix builds
   (.dmg/.exe/.deb+AppImage) check out that sha; only after EVERY leg
   succeeds does `desktop-release` push the `desktop-v<version>` tag
   (**tag-after-build invariant** — a failed build must never burn the
   version, A22) and create a **DRAFT** GitHub Release.
4. **Human publishes the draft** → self-update goes live: the stager picks
   the semver-highest PUBLISHED `desktop-v*` release (drafts/prereleases
   skipped). Draft = no client updates, by design.

Operating notes:
- Tier-1 bundle signing needs the `MOXXY_UPDATE_SIGNING_KEY` secret (Linux
  leg); absent (forks) the floor still ships, hot-update assets are skipped.
- A broken draft (e.g. A1's 0.0.33): do NOT publish; fix, let the next
  Version PR re-cut, delete the bad draft + tag.
- npm publish needs the `NPM_TOKEN` secret; Version-PR mode works on
  `GITHUB_TOKEN` alone.
- Deeper: AGENTS.md → "Releasing", docs/desktop-self-update.md,
  docs/desktop-code-signing.md.
