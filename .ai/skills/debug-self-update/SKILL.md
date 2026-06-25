---
name: debug-self-update
description: Diagnose desktop self-update problems (update downloads but reverts, stuck on floor, rollback loops) from the on-disk state files — use for any Tier-1 hot-update misbehavior.
---

# Debug desktop self-update

Full design: `docs/desktop-self-update.md`. State lives in `<userData>/app/`
(macOS: `~/Library/Application Support/MoxxyAI Workspaces/app/`):

| File | Meaning |
|---|---|
| `active.json` | which staged bundle the bootstrap should load |
| `confirmed.json` | last version that PROVED healthy (DOM render confirmed) |
| `bad.json` | poisoned versions — bootstrap refuses them forever |
| `last-attempt.json` | breadcrumb written before loading an override; survives a crash |
| `boot-log.json` | rolling 50-entry decision log: every boot/probe/confirm/reject + structured WHY |
| `<version>/` | one dir per staged bundle |

Read `boot-log.json` FIRST — reject reasons are structured:
`bad-signature`, `file-tampered` (per-file sha256 map mismatch — the signed
`files` map is re-verified at EVERY load; legacy pre-map manifests are
grandfathered and not load-checked), version/ABI gate failures, probe
timeouts.

Classic signatures:
- **Every staged version in `bad.json`, `confirmed.json` missing** → the
  health confirm never lands. Was the renderer-heartbeat bug (PR #115); now
  main polls the DOM (`#splash-fallback` replaced on React mount). Suspect
  anything that delays first render >15s.
- **Update "succeeds" then 404s on download** → release left as DRAFT. The
  stager resolves the semver-highest PUBLISHED `desktop-v*` release via the
  GitHub API (skips drafts/prereleases; never `releases/latest`). Publish it.
- **Hot bundle fails but floor works** → externalized workspace dep (A1) —
  see verify-desktop-packaged skill.

Tools:
- In-app: update dashboard → Diagnostics (`app.updateDiagnostics` IPC).
- Tests: `pnpm --filter @moxxy/desktop-host test app-update` (full
  build→stage→load round-trip incl. rollback).
- Dev override: `MOXXY_UPDATE_URL` (non-packaged runs only, by design).
- Recovery on a poisoned machine: delete `bad.json` + `active.json` to force
  the floor, or stage a fixed release — the fix must live in the OVERRIDE's
  main to stick.
