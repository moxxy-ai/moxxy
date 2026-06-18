# @moxxy/plugin-channel-mobile

## 0.1.15

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3
  - @moxxy/desktop-ipc-contract@0.7.5
  - @moxxy/ipc-server-ws@0.1.14
  - @moxxy/plugin-channel-web@0.0.20

## 0.1.14

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2
  - @moxxy/desktop-ipc-contract@0.7.4
  - @moxxy/ipc-server-ws@0.1.13
  - @moxxy/plugin-channel-web@0.0.19

## 0.1.13

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1
  - @moxxy/desktop-ipc-contract@0.7.3
  - @moxxy/ipc-server-ws@0.1.12
  - @moxxy/plugin-channel-web@0.0.18

## 0.1.12

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0
  - @moxxy/desktop-ipc-contract@0.7.2
  - @moxxy/ipc-server-ws@0.1.11
  - @moxxy/plugin-channel-web@0.0.17

## 0.1.11

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/desktop-ipc-contract@0.7.1
  - @moxxy/ipc-server-ws@0.1.10
  - @moxxy/plugin-channel-web@0.0.16

## 0.1.10

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0
  - @moxxy/desktop-ipc-contract@0.7.0
  - @moxxy/plugin-channel-web@0.0.15
  - @moxxy/ipc-server-ws@0.1.9

## 0.1.9

### Patch Changes

- Updated dependencies [c15a45a]
  - @moxxy/desktop-ipc-contract@0.6.1
  - @moxxy/ipc-server-ws@0.1.8

## 0.1.8

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0
  - @moxxy/desktop-ipc-contract@0.6.0
  - @moxxy/ipc-server-ws@0.1.7
  - @moxxy/plugin-channel-web@0.0.14

## 0.1.7

### Patch Changes

- 54526cc: Fix the phone never connecting to the desktop-started mobile gateway on the same network. Two defects: (1) the advertised QR host picked the first non-internal IPv4, so a VPN/Docker/link-local interface could be advertised instead of the reachable LAN IP — `lanHost` now ranks candidates (RFC1918 on physical NICs first, skipping utun/vmnet/bridge/awdl-style interfaces unless nothing else exists); (2) the built mobile app was missing iOS's `NSLocalNetworkUsageDescription` (iOS 14+ silently denies LAN dials without it) and Android's cleartext-`ws://` allowance — both added to app.json (requires a new native build; OTA updates do not deliver Info.plist/manifest changes). Expo Go masked both, which is why dev pairing worked.

## 0.1.6

### Patch Changes

- Updated dependencies [d0e0bd2]
  - @moxxy/desktop-ipc-contract@0.5.0
  - @moxxy/ipc-server-ws@0.1.6

## 0.1.5

### Patch Changes

- @moxxy/ipc-server-ws@0.1.5
- @moxxy/plugin-channel-web@0.0.13

## 0.1.4

### Patch Changes

- 2796066: feat(workflows): human-in-the-loop awaitInput — resume RPC + operator reply UI (un-gate)

  A workflow step can set `awaitInput: true` to pause and ask the operator a
  question, then continue with their reply. #146 gated this at validate/save time
  because the resume path hadn't shipped. The resume path now ships, so the gate
  is removed.

  - **Un-gate:** `awaitInput: true` is accepted again on **prompt/skill steps**
    (rejected on tool/workflow/logic/loop steps and on a loop body); `draft.ts`
    teaches the mid-run pause flow again with a worked example.
  - **Resume RPC (additive, protocol v5):** new `RunnerMethod.WorkflowResume`
    (`workflow.resume`) — server handler → `session.workflows.resume(runId, reply)`;
    `WorkflowsView.resume` (SDK) + CLI impl over the existing `resumeWorkflowRun`;
    `RemoteSession` client method gated on server protocol `>= 5` with the actionable
    "update the CLI" error (mirrors the v4 builder gate). `MIN_COMPATIBLE` stays at 1.
  - **Desktop / mobile / TUI:** `workflows.resume` added to the desktop IPC contract
    (+ host handler), the MobileSessionHost bridge, and `REMOTE_ALLOWED_COMMANDS`
    (RESPOND-only — answering a question the workflow asked, like `ask.respond`).
    Operator reply UI: desktop paused-workflow card (new client-core
    `usePausedWorkflows` hook) and TUI inline reply in the `/workflows` panel.
  - **Correctness:** the `workflow_paused` event now carries the workflow name +
    step label + question; vars set before a pause survive the checkpoint round-trip;
    `runNow` keeps treating a `paused` result as non-terminal (and the resume side
    delivers the now-completed run to the inbox); the stale-checkpoint sweeper +
    `clearRetainedChildren()`-on-shutdown are kept.

- Updated dependencies [5ab8629]
- Updated dependencies [2796066]
  - @moxxy/desktop-ipc-contract@0.4.0
  - @moxxy/sdk@0.10.0
  - @moxxy/ipc-server-ws@0.1.4
  - @moxxy/plugin-channel-web@0.0.13

## 0.1.3

### Patch Changes

- 00d7425: Desktop mobile gateway: deny-by-default remote command allow-list + gateway hardening.

  **Security fix (critical/high).** The runtime mobile gateway (Settings → Mobile, PR #141) wired the desktop's COMPLETE IPC handler set onto the WebSocket bus and bound the LAN wildcard. The only per-command filter for remote clients was a blocklist that omitted host-mutating commands — so a paired phone (or anyone on the LAN with the bearer token) could invoke `session.setAutoApprove` (disable the desktop's approval prompts, then run any tool unattended), `desks.create`/`rename`/`remove`, `onboarding.saveProviderKey`/`openExternal`, `app.updateCli`/`checkUpdate`/`updateDashboard`, vault/settings/prefs writes, and more — a privilege-escalation / RCE-adjacent hole.

  The model is now **allow-by-default-deny**. `@moxxy/desktop-ipc-contract` exports `REMOTE_ALLOWED_COMMANDS` — the single source of truth for the remote/mobile trust surface (the exact commands a paired chat client needs: session info/runTurn/abort/setMode/newSession/runCommand, transcribe, ask RESPOND, connection discovery/retry, the per-workspace transcript log, and `workflows.list`/`run`/`getRun`). `@moxxy/ipc-server-ws`'s `WebSocketCommandBus` rejects any command not on the list with a coded error, regardless of what handlers the host registered. The Electron (renderer) bus keeps full access — only the WS/remote bus is restricted. `REMOTE_DISALLOWED_COMMANDS` is kept (deprecated) for renderer affordance-gating but no longer drives enforcement.

  **Finding 2 (medium).** Workflow AUTHORING is host-only: `workflows.save`, `workflows.validateDraft`, and `workflows.setEnabled` are NOT on the remote allow-list — a paired phone cannot rewrite or re-enable the host's workflows. Read + run (`list`/`getRun`/`run`) stay allowed.

  **Finding 3 (medium, stability).** `MobileGatewayManager` start/stop/setEnabled/rotate/resume now serialize through a lifecycle lock, so a rapid off→on toggle (or a boot resume racing a user toggle) can't double-bind the port or leak a LAN-bound listener.

  **Finding 4 (medium).** Token rotation is now coherent with a pinned `MOXXY_WS_TOKEN`: rotation is a no-op-with-warning when the env token pins the credential (it can't be rotated from here without diverging the advertised connectUrl from the live accepted token), and `status()`/`connectUrl` always reflect the live accepted token.

  **Finding 5 (medium, security UX).** The Mobile tab warning now states plainly that the connection is unencrypted plain `ws://`, so anyone on the network can passively intercept the pairing token and all traffic without the QR — use only on trusted networks.

  The standalone `moxxy mobile` host (`@moxxy/plugin-channel-mobile`) is its own trust surface (it registers a curated single-session subset) and opts out of the contract allow-list via `new WebSocketCommandBus({ allowedCommands: null })`. The wave-5 hardening (Origin default-deny, bearer subprotocol auth, connection caps, slow-reader eviction) is unchanged and still applies on the runtime-gateway path.

- e606178: Mobile app port (phase 2a, data layer): the mobile channel's `MobileSessionHost` now serves the full command subset the Expo app drives — `session.setMode` (re-broadcasts the connected phase so clients see the new mode), `session.newSession` (aborts in-flight turns, then `SessionLike.reset()` with a `log.clear()` fallback), `session.runCommand` (the session command registry, channel `'mobile'`), voice (`session.hasTranscriber` probes the transcriber registry; `session.transcribe` runs the active transcriber or fails with the new coded `not-supported` error), and workflows (`workflows.list` returns the typed empty list when the plugin is absent; `workflows.run` fails coded `not-supported`). `session.runTurn` now forwards the new `inlineAttachments` to the session (mobile clients can't reference host paths, so the payload itself crosses the wire).

  Contract additions (all additive): the `not-supported` `MoxxyIpcErrorCode` for capability-absent commands, `RunTurnArgs.inlineAttachments` (SDK `UserPromptAttachment` shape, size/count-bounded in validation), and boundary Zod schemas for `session.runCommand` (closing the audit-flagged gap — it was the one mutating session command without a schema, on desktop too), `workflows.run`, and `workflows.setEnabled`.

- 6afc4c0: Workflows engine (phase 1 of 2): port the logic-step + agentic-authoring engine onto current main, and add a bounded while-loop node.

  **Engine features ported.** `@moxxy/plugin-workflows` now supports logic steps — `bridge` (extract/transform upstream output into `vars`), `condition` (if/else gate routed by an LLM `{"branch":"then"|"else"}`), and `switch` (multi-way gate routed by case id) — plus a `format: json|plain` field, branch fields (`then`/`else`/`cases`/`default`), a persisted-only `ui.layout` schema (node x/y + viewport, no editor here), agentic YAML authoring (`draft.ts` `buildSystemPrompt`/`draftWorkflow` + the `workflow_create` tool teaching the full schema), LLM branch-predicate parsing (`logic-response.ts`), and `awaitInput` pause/resume for prompt/skill steps (`run-store.ts` checkpoints under `~/.moxxy/workflow-runs/active/` + executor `resumeWorkflowRun`). The DAG executor (`executor/dag.ts`) gains `runLogicStep`, `mergeVars`, `applyBranchSkips`, and an `ExecutorContext`, merged surgically onto main's baseline — main's `MAX_NESTING_DEPTH` guard and behavior are preserved, as is the CLI's separate inter-workflow `afterWorkflow` cycle guard (`MAX_AFTER_WORKFLOW_CHAIN`, Tarjan SCC). The SDK gains the matching types (`WorkflowLoopAction`, `WorkflowLogicStepFormat`, `WorkflowRunStatus`, `WorkflowUi*`, `awaitInput`, `retainSession`, `SubagentContinueArgs`); core's subagent runtime gains retained-session `continue()`/`release()` (new `run-child.ts` + `registry.ts`) backing the pause/resume flow.

  **New `loop` node.** A `loop: { body: string[], condition: string, maxIterations: 1..50 (default 10) }` action repeats its body steps in order each iteration (resetting their state per pass, honoring `onError`), then evaluates `condition` via the same LLM predicate as a `condition` step. `condition` is the loop's EXIT/GOAL condition — the body repeats UNTIL it is met: `then` = condition met → STOP (continue to the next step), `else` = not yet met → run another iteration. A body step error BREAKS the loop to the next step (the loop returns ok with a "broke on error" note rather than failing the whole workflow), unless that body step sets `onError: continue` (which swallows the error and keeps iterating). It is unmistakably safe: it terminates when the exit condition is met, when a body error breaks it, OR at `maxIterations` (finishing with a clear note, never hanging), and composes with `MAX_NESTING_DEPTH` (a body that calls nested workflows still bottoms out at the depth cap). The iteration cap and the depth cap are independent guards; neither can be defeated by the other. Schema rejects loops combined with `then`/`else`/`cases`/`default`, empty bodies, out-of-range `maxIterations`, unresolvable body ids, and `awaitInput` on a loop.

  **IPC for the upcoming visual builder (phase 2).** Additive, capability-detectable commands `workflows.validateDraft` (parse YAML → errors), `workflows.save` (persist a workflow), and `workflows.getRun` (fetch canonical YAML): zod-validated contract + a desktop-host pass-through handler + new optional `WorkflowsView` methods, with the mobile `MobileSessionHost` extended to parity. The visual builder GUI itself is phase 2 (follow-up).

- Updated dependencies [1e4ed09]
- Updated dependencies [00d7425]
- Updated dependencies [cdc2cc5]
- Updated dependencies [e606178]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/plugin-channel-web@0.0.12
  - @moxxy/desktop-ipc-contract@0.3.0
  - @moxxy/ipc-server-ws@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/plugin-channel-web@0.0.11
  - @moxxy/desktop-ipc-contract@0.2.2
  - @moxxy/ipc-server-ws@0.1.2

## 0.1.1

### Patch Changes

- f297da0: `moxxy mobile` no longer prints an unconnectable QR in the default config. The server binds loopback by default (deliberate security posture, unchanged) but the QR advertised the machine's LAN IP — an address nothing was listening on, so a real phone got connection refused. The connect URL now advertises exactly what is reachable: the loopback default prints `ws://127.0.0.1:<port>` (works for simulators on the same machine) plus a hint that a real device needs the explicit LAN opt-in or a tunnel; a wildcard bind (`0.0.0.0`/`::`) advertises the LAN IP; an explicit bind host is advertised verbatim; the tunnel path is unchanged. Also adds `MOXXY_MOBILE_HOST` (env → `channels.mobile.bindHost` config → loopback default, matching the channel's token/tunnel convention) and updates `apps/mobile/README.md` to document simulator-via-loopback vs phone-via-opt-in/tunnel.
- 0326fb0: Harden the desktop/mobile WebSocket bridge (2026-06-09 audit, wave 5):

  - Reject browser-Origin upgrades unless allow-listed (`allowedOrigins`, default deny; native clients are unaffected).
  - Move the pairing token out of the URL: `Authorization: Bearer` or a `Sec-WebSocket-Protocol` bearer entry are the supported presentations; the legacy `?t=` query is opt-in (`allowQueryToken`, kept on only for the mobile channel's already-paired apps). The QR still carries the token, but the app strips it before connecting.
  - Token rotation end to end: `rotateChannelToken` (sdk, persisted with `createdAt` + 90-day staleness warning), `rotateAuthToken` on the live server (drops existing connections), `rotateWsBridgeToken` (desktop) and `MobileChannel.rotateToken`.
  - Backpressure + lifecycle: connection cap (default 8), slow-reader eviction (backlog above 4 MB past a 10s grace terminates the socket), and `close()` now terminates clients so desktop quit doesn't burn its shutdown timeout.
  - `WsRpcClient` no longer replays abandoned requests after reconnect (outbox cleared, queued requests rejected on disconnect) and stops reconnecting after a capped exponential backoff, surfacing a terminal `disconnected` status.
  - Hygiene: empty `MOXXY_WS_PORT` no longer binds an ephemeral port, the server reports the actually-bound port, and the desktop bridge reuses the shared sdk token persistence (userData location kept).

- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0
  - @moxxy/ipc-server-ws@0.1.1
  - @moxxy/plugin-channel-web@0.0.10
  - @moxxy/desktop-ipc-contract@0.2.1

## 0.1.0

### Minor Changes

- 85f9b91: Share the desktop client layer across platforms and expose the IPC over a WebSocket.

  The desktop renderer's hooks, state stores, chat model, and IPC client are now
  transport- and platform-agnostic so a future mobile app can reuse them:

  - **`@moxxy/client-core`** — the `use*` hooks + chat/connection/ask stores + chat
    model + the transport singleton + a platform-capability registry. DOM-free; the
    desktop renderer consumes it via thin `@/lib/*` shims (no behavior change).
  - **`@moxxy/client-platform-web`** — the Web implementations of those capabilities
    (mic capture/PCM16, Web Speech TTS, localStorage, window event bus).
  - **`@moxxy/design-tokens`** — framework-neutral tokens + a `:root` CSS generator.
  - **`@moxxy/client-transport-ws`** — a `MoxxyApi` over the global `WebSocket`
    (no Node deps), for remote clients.
  - **`@moxxy/ipc-server-ws`** — serves the same `IpcCommands`/`IpcEvents` contract
    over an authenticated WebSocket (loopback by default, bearer-token gated). The
    desktop's IPC handler registration is now transport-neutral (a `CommandBus`/
    `EventSink` seam + a shared `dispatch` core in `@moxxy/desktop-ipc-contract`), so the
    same handler bodies serve Electron IPC and the WebSocket; events fan out to both.
  - **`@moxxy/plugin-channel-mobile`** — a `mobile` channel that serves the bridge from
    the CLI backed by the runner's single session: `moxxy mobile` (and `moxxy serve --all`)
    expose it with no desktop needed. It can reach beyond the LAN via a cloudflared/ngrok
    tunnel (`channels.mobile.tunnel`) and prints a **QR code** (URL + token embedded) to
    pair. The desktop bridge stays opt-in via `MOXXY_WS_BRIDGE`.
  - **`@moxxy/sdk`** — adds `resolveChannelToken` + `bearerGuard`: the standard channel
    auth-token resolution (env → `channels.<name>.token` → a persisted secret) and a
    pre-connection bearer handler, so channels gate connections uniformly. The mobile
    bridge + WS server adopt them.

  A new `apps/mobile` Expo proof-of-concept drives the chat loop (and permission prompts)
  through the shared hooks over the WebSocket bridge — against either backend. First launch
  shows a QR scanner that pairs by scanning `moxxy mobile`'s code. Desktop behavior is
  unchanged.

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/desktop-ipc-contract@0.2.0
  - @moxxy/ipc-server-ws@0.1.0
  - @moxxy/plugin-channel-web@0.0.9
