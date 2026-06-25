---
---

Redesign the release pipeline to be conflict-free by construction: versioning now
happens on `development` (prepare-release.yml — daily/on-demand `changeset version`,
batching the day's changesets into one bump, then opens the development→main PR);
`main` is publish-only (release.yml no longer runs `changeset version`). Because
main never edits version files it is always an ancestor of development, so
development→main never conflicts. (Docs/CI only — releases nothing.)
