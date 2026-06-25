---
---

chore: adopt a `development` / `main` branch model. Feature PRs target `development` (CI + changeset gate); `main` is production, updated only by an on-demand `development → main` release PR (or manual `workflow_dispatch`). CI now runs on both branches; the changeset gate applies only to PRs into `development`; changesets `baseBranch` is `development`. No code/release changes — versioning still rides changesets.
