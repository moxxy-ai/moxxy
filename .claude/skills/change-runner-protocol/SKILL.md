---
name: change-runner-protocol
description: Change the runner↔thin-client wire protocol (RunnerMethod, notifications) and bump RUNNER_PROTOCOL_VERSION correctly — use for any packages/runner protocol edit.
---

# Change the runner protocol

The contract lives in `packages/runner/src/protocol.ts`
(`RUNNER_PROTOCOL_VERSION`, currently 7; `MIN_COMPATIBLE_PROTOCOL_VERSION`,
currently 1; `RunnerMethod`; zod param schemas).
Clients: TUI, desktop supervisor, anything using `connectRemoteSession`.

Rules (tolerant negotiation since B2, branch fix/runner-protocol-skew):
- **Any protocol change** (even additive) → bump `RUNNER_PROTOCOL_VERSION`
  AND document it in the version-history docstring right above it
  (`v2: ...`, `v7: ...` — keep the convention).
- **Breaking change only** → ALSO bump `MIN_COMPATIBLE_PROTOCOL_VERSION` to
  the new version. The handshake accepts any client `>= MIN_COMPATIBLE`; the
  server reports its own version in `AttachResult.protocolVersion`.
- New client-called methods must be GATED on the server's reported version via
  `RemoteSession.requireServerProtocol(N, 'Feature name')` so a newer client
  on an older runner gets an actionable "update the CLI" error, not a raw
  method-not-found (see the v4 workflow-builder family or the v7
  providerAdmin view for the pattern).
- Desktop floor lockstep: `apps/desktop/electron/main/floor-runner-protocol.ts`
  bakes `FLOOR_RUNNER_PROTOCOL` as a literal — bump it with the version; the
  release build asserts it matches `@moxxy/runner` (scripts/build-app-bundle.mjs),
  and the signed app-bundle manifest carries the stamp the bootstrap's
  skew gate checks.

Mismatch recovery expectations (`remote-session.ts`): on a genuine "protocol
mismatch" (client `< MIN_COMPATIBLE`) the CLIENT proactively kills the stale
daemon and unlinks the socket — but only after verifying the holder's `ps`
line carries a moxxy marker (never kill-by-port blind, A7); it also frees
default port 4040 (web surface). Callers retry/self-host on a clean slate.
Opt-outs: `skipMismatchRecovery`, injected transports skip it automatically.
If you change attach/recovery, keep `MOXXY_RUNNER_STRICT_ABORT` and the
socket-dir-0700-before-listen hardening intact (A31).

Also update:
- `RemoteSession` (client) + `server.ts` (server) + `SessionLike` optional
  member if it's a new capability (capability-detection: clients must degrade
  when the member is undefined, not crash).
- Desktop: runner pool/supervisor in `packages/desktop-host` consumes the
  protocol — check `runner-supervisor.ts`.
- Tests: `packages/runner/src/integration.test.ts` pins the handshake +
  per-method behavior; add a case for your change and a mismatch test if you
  bumped MIN_COMPATIBLE.

Changeset: `@moxxy/cli` (runner is bundled) + `@moxxy/desktop` if the desktop
must pick it up.
