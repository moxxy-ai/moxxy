---
---

Release-infra only (scripts/ is unversioned — no package bump): `scripts/safe-publish.mjs` can no longer permanently ship a broken `@moxxy/cli`.

It used to publish in `readdirSync` order, so `cli` (whose `workspace:*` dep pnpm rewrites to an EXACT `@moxxy/sdk` pin at pack time) could publish before `sdk`; if `sdk` then tombstone-bumped (npm history shows real walked gaps), `cli` was live and pinned to a version that will never exist. Now: (1) publishable packages are topologically sorted over their `workspace:` dependency graph — dependencies publish first, so a tombstone bump persisted to the dependency's package.json is exactly what the dependent's pack rewrites against; (2) dependents of a hard-failed publish are blocked (reported, exit 1) instead of shipped broken; (3) a post-publish consistency check `npm view`s every package published in the run and verifies each shipped `@moxxy/*` pin exists on the registry, failing loudly otherwise. Adds `--dry-run`/`--help`, and unit tests for the pure helpers (`pnpm test:scripts`, chained into root `pnpm test`).
