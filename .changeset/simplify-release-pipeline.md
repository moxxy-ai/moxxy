---
"@moxxy/desktop": patch
---

chore(ci): collapse the release pipeline into one changeset-driven workflow.
The desktop installers now build + ship as gated jobs inside `release.yml`
(folding in `release-desktop.yml`), removing the auto-PR machine and the
cross-workflow dispatch. `@moxxy/cli` is now a declared desktop dependency, so a
CLI/SDK release cascades a patch bump and cuts a desktop release automatically.
A `Changeset present` CI job now fails any PR that lacks a changeset (use
`pnpm changeset --empty` for no-release changes).
