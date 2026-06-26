---
---

chore(ci): single auto-advancing release workflow (no dev→main PR, no sync-back).

Release infra only — ships no package. `release.yml` now runs on `development`
and, in one run, versions → publishes to npm → advances `main` via a `git
commit-tree` tree-copy (cannot conflict) → cuts the desktop. Deletes
`prepare-release.yml` and `sync-back.yml`.
