---
---

Docs-only (no release impact): `docs/desktop-code-signing.md` and
`docs/desktop-self-update.md` reconciled against the current release pipeline and
self-update code — tag-after-build release ordering (pinned sha, draft release),
the signed per-file integrity map (stage-time + load-time verification, legacy
grandfathering), main-process DOM health-confirm, the ESM `package.json` marker,
the boot-decision log / `app.updateDiagnostics`, GitHub-API release discovery,
and the actual macOS/Windows signing-secret wiring.
