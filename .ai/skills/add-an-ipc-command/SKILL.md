---
name: add-an-ipc-command
description: Add a command to the desktop IPC contract (renderer↔main) — use when the desktop UI needs a new backend call.
---

# Add an IPC command

The contract is transport-neutral: handlers register against a `CommandBus`,
and Electron IPC is the transport behind it. Checklist (in order):

1. **Contract** — `packages/desktop-ipc-contract/src/index.ts`: add the
   command to `IpcCommands` (name + payload/return types). Naming:
   `<domain>.<verb>` (`session.runTurn`, `app.checkUpdate`).
2. **Validation** — `packages/desktop-ipc-contract/src/validation.ts`: if the
   command touches fs / child process / vault / openExternal / URLs, add a zod
   schema. Compile-time types do NOT protect main from an XSS'd renderer;
   only "dangerous" commands are listed, deliberately.
3. **Handler** — `packages/desktop-host/src/ipc/<domain>.ts`: register inside
   that domain's `register<Domain>Handlers(...)` via the shared `handle()`
   choke point (`ipc/shared.ts:127`) — it runs validation + wraps errors into
   the stable `MoxxyIpcError` envelope. Handlers register against the
   `CommandBus` seam (`desktop-ipc-contract/src/bus.ts`) and never see the
   transport.
4. **Client** — the renderer calls through `MoxxyApi.invoke` /
   `window.moxxy`; shared hooks live in `packages/client-core` (DOM-free!
   platform specifics go through the capability registry).
5. Main→renderer events instead: `IpcEvents` + `EventSink.broadcast` —
   payloads carry `workspaceId` for client-side routing.

Notes:
- Renderer+main always ship in the same Tier-1 bundle, so renaming/removing
  IPC commands is SAFE across self-update (no skew) — unlike the runner
  protocol (see change-runner-protocol skill).
- Test: validation cases in `validation.test.ts`, dispatch in
  `dispatch.test.ts`; handler tests in desktop-host.
