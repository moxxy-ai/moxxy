---
name: change-runner-protocol
description: Change the runner↔thin-client wire protocol (RunnerMethod, notifications) and bump RUNNER_PROTOCOL_VERSION correctly — use for any packages/runner protocol edit.
---

# Change the runner protocol

The contract lives in `packages/runner/src/protocol.ts`
(`RUNNER_PROTOCOL_VERSION`, currently 3; `RunnerMethod`; zod param schemas).
Clients: TUI, desktop supervisor, anything using `connectRemoteSession`.

Rules:
- **Additive + tolerated by old peers** (new optional field, new method the
  server can 404 cleanly) → NO bump needed.
- **Incompatible** (changed semantics, required new method for correctness —
  e.g. v3's `session.reset`, PR #129) → bump `RUNNER_PROTOCOL_VERSION` AND
  document the change in the version-history docstring right above it
  (`v2: ...`, `v3: ...` — keep the convention).
- `attach` exchanges versions; mismatch fails LOUDLY server-side
  (`server.ts:187`) — never let a stale peer limp along.

Mismatch recovery expectations (`remote-session.ts:643+`): on "protocol
mismatch" the CLIENT proactively kills the stale daemon and unlinks the
socket — but only after verifying the holder's `ps` line carries a moxxy
marker (never kill-by-port blind, A7); it also frees default port 4040 (web
surface). Callers retry/self-host on a clean slate. Opt-outs:
`skipMismatchRecovery`, injected transports skip it automatically. If you
change attach/recovery, keep `MOXXY_RUNNER_STRICT_ABORT` and the
socket-dir-0700-before-listen hardening intact (A31).

Also update:
- `RemoteSession` (client) + `server.ts` (server) + `SessionLike` optional
  member if it's a new capability (capability-detection: clients must degrade
  when the member is undefined, not crash).
- Desktop: runner pool/supervisor in `packages/desktop-host` consumes the
  protocol — check `runner-supervisor.ts`.
- Tests: `packages/runner/src/integration.test.ts` pins the handshake +
  per-method behavior; add a case for your change and a mismatch test if you
  bumped.

Changeset: `@moxxy/cli` (runner is bundled) + `@moxxy/desktop` if the desktop
must pick it up.
