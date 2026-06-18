# @moxxy/runner

## 0.2.12

### Patch Changes

- 0870222: feat(runner): paged `session.loadHistory` + complete authoritative log

  Add the runner-side foundation for retiring the desktop's dual chat history (the
  renderer will later read transcript history from the runner instead of its own
  NDJSON store).

  - New runner protocol method `session.loadHistory` ({ before, limit } →
    { events, prevCursor }) — newest-first paging over the runner's authoritative
    event history. Bumps `RUNNER_PROTOCOL_VERSION` to 10; the change is purely
    additive, so `MIN_COMPATIBLE_PROTOCOL_VERSION` stays at 1 and an older client
    still attaches. `RemoteSession.loadHistory` gates the call on the server
    reporting v10+ and throws a clear, actionable "update the CLI" error against
    an older runner — which the desktop catches to fall back to its existing
    NDJSON path, so no transcript ever goes blank. The desktop FLOOR is
    intentionally NOT raised (the fallback keeps an older runner working); the
    release-build lockstep guard now allows the floor to lag an additive,
    version-gated runner bump.
  - `@moxxy/core` gains a PAGED JSONL reader (`readSessionEventPage` + the pure
    `pageEvents` helper) that reads one `(before, limit)` page WITHOUT
    re-materializing the whole log, so `loadHistory` works even when the log isn't
    all in memory. Read-only — it preserves persistence's atomic-write + mutex
    invariants (it never mutates the file).
  - Log completeness: when a turn streams assistant text but the provider never
    seals it with an `assistant_message` (e.g. an error/abort mid-stream — the
    case the renderer used to paper over by synthesizing a message that lived in
    no runner log), the runner now persists a REAL `assistant_message` on turn
    completion so its log is the complete authoritative history. Behavior-
    preserving for the normal sealed path.

- Updated dependencies [0870222]
  - @moxxy/core@0.4.0

## 0.2.11

### Patch Changes

- Updated dependencies [6c48c28]
  - @moxxy/core@0.3.0

## 0.2.10

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/core@0.2.9

## 0.2.9

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/core@0.2.8

## 0.2.8

### Patch Changes

- 897a1fc: Long-tail review fixes (quality sweep, t3 cluster):

  - plugin-oauth: thread the flow's abort signal into device-flow poll fetches (and the OpenAI token exchange) so a hung in-flight poll cancels, not just the inter-poll sleep; drop redundant clearTimeout calls in the callback server (settle() is the single cleanup chokepoint); document the credential-lock stale-takeover TOCTOU window.
  - plugin-vault: randomCode now draws width-appropriate entropy and rejection-samples — fixes the silent leading-digit cap for codes >= 10 digits and the modulo bias.
  - plugin-mcp: one malformed mcp.json entry no longer discards the whole server catalog (per-entry parse keeps valid rows); MCP resource results pass through inline text instead of a bare [resource]; createMcpPlugin connects servers in parallel (boot bounded at the slowest, not the sum).
  - plugin-scheduler: describeEntry shares the poller's next-fire baseline so the displayed next-fire agrees with when isDue fires; tickOnce counts due-and-attempted schedules (counts a fired-but-failed run).
  - workflows-builder: block-scalar parser strips indentation by the minimum body indent (no longer corrupts a literal block whose lines are shallower than the first).
  - runner: createUnixSocketServer.onConnection is single-handler (last-write-wins), consistent with Transport.onFrame/onClose.
  - mobile-poc: boot the env-URL transport in an effect (not a render-phase useState initializer); guard approval allow/deny against forwarding an empty optionId.

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4
  - @moxxy/core@0.2.7

## 0.2.7

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3
  - @moxxy/core@0.2.6

## 0.2.6

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2
  - @moxxy/core@0.2.5

## 0.2.5

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1
  - @moxxy/core@0.2.4

## 0.2.4

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0
  - @moxxy/core@0.2.3

## 0.2.3

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/core@0.2.2

## 0.2.2

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0
  - @moxxy/core@0.2.1

## 0.2.1

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0
  - @moxxy/core@0.2.0

## 0.2.0

### Minor Changes

- 4c594d8: Wave of desktop/mobile fixes. Runner protocol v6 (additive): clients can supply the turn id (`runTurn.turnId`) so renderer per-turn filters actually match — fixing the silently-broken "generate skill with AI" flow and hidden-turn leaks — and `attach` gains a replay policy (`'full' | 'none' | { tail }`) with EventLog rebase so the desktop no longer replays full session history on app start/desk switch (history comes from the paginated NDJSON log). Desktop settings gain a shared "ask moxxy to do it" background-agent modal: the skill generator is refactored onto it and MCP servers and Providers get Add buttons driving `mcp_add_server`/`provider_add`, with permission asks surfaced in-modal (plus a global ask fallback outside the chat view). Subagents now inherit the parent's resolved model: hallucinated model ids warn and fall back, workflow-trigger spawns use the session's last resolved model, and hardcoded model-id fallbacks are gone. Clerk sign-in returns to the app instead of stranding on the hosted My-account page (explicit fallback redirect URLs + a main-process account-portal recovery handler). Workflow canvas: Delete/Backspace removes the selected node and dropping a connector on empty canvas opens an insert-node menu. Mobile: reconnects re-prime the connection store (fixes the deaf "Connected" state after a runner restart), gateway URL commits on blur, the redundant header actions toggle is gone, menu entries are chips, executed tools open a diagnostics panel on tap, and the QR scanner starts scanning immediately.

### Patch Changes

- Updated dependencies [4c594d8]
  - @moxxy/core@0.1.0

## 0.1.0

### Minor Changes

- 5ab8629: fix(runner): tolerate additive protocol skew + stop the desktop hot-update reconnect loop

  A desktop Tier-1 hot-update ships only the JS bundle, so it advances the bundled
  `@moxxy/runner` client past the separately-bundled CLI's runner. The strict
  `protocolVersion !==` handshake then rejected the (purely additive) skew and the
  supervisor respawned the SAME pinned CLI forever — an infinite "Reconnecting…".

  - **Tolerant negotiation (contract change):** new `MIN_COMPATIBLE_PROTOCOL_VERSION`
    (bumped only on a BREAKING protocol change). The server accepts any client
    `>= MIN_COMPATIBLE` and returns its own version; the client records the server
    version and gates the v4-only `workflow.validateDraft/save/getRun` builder methods
    on it, degrading with a clear "update the CLI" error instead of a raw
    method-not-found. Additive skew now attaches cleanly.
  - **Desktop lockstep:** the signed app-bundle manifest carries a `runnerProtocol`
    stamp; the bootstrap refuses to activate (reverts to floor) any JS bundle whose
    stamp exceeds the spawnable CLI's protocol.
  - **No infinite loop:** a persistent mismatch surfaces a terminal
    `protocol-incompatible` connection phase with an actionable message after one
    failed recovery, rather than retrying into the same dead end.

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

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0
  - @moxxy/core@0.0.13

## 0.0.12

### Patch Changes

- 4a8ec5d: Workflows round-2 correctness: gate the unshippable `awaitInput` resume, make the visual builder work on the desktop, and fix loop/validation correctness.

  **`awaitInput` is gated (was a hang-forever dead-end).** The executor can pause + checkpoint an `awaitInput` step, but the resume trigger/channel that delivers the operator's reply never shipped to `main` — `resumeWorkflowRun` had zero production callers. So an agent-drafted "ask me, then act" workflow would pause forever, leak a retained child session for the process lifetime, and orphan a checkpoint file. `awaitInput` is now **rejected at validate/save time** with a clear "requires the resume channel, not available in this build" message, and `draft.ts` no longer teaches it (it steers the author to `inputs` fields instead). Defense-in-depth: the CLI runner treats a `paused` result as non-terminal (no inbox delivery), `Session.close()` clears retained child sessions so they can't leak, and a `WorkflowRunStore.sweepStale()` sweeper (7-day TTL, run on workflows boot) reaps orphaned `~/.moxxy/workflow-runs/active/` checkpoints. The executor pause/resume path is kept intact so re-enabling is a matter of landing a resume trigger and removing the schema gate.

  **Visual builder works on the desktop now.** The desktop drives a `RemoteSession`, whose workflows view only forwarded `list`/`setEnabled`/`run` — so the builder's `validateDraft`/`save`/`getRun` were `undefined` and threw "not supported on this session". Added a `workflow.validateDraft|save|getRun` runner-RPC family (**protocol bumped to v4**) with RemoteSession client methods + server handlers, so the desktop builder validates/saves/loads against the runner.

  **Loop + validation correctness.** A condition/switch step used as a loop body is rejected (its branch routing was silently ignored). A non-loop-body step that `needs` a loop-body step is rejected (it would stall — body steps are excluded from the main DAG). A loop-body step's own `when` guard and any `needs` other than its loop step / a sibling body step are rejected (body steps run unconditionally each iteration). Logic-step `vars` now drop `__proto__`/`constructor`/`prototype` keys (prototype-pollution guard). Paused-run checkpoints persist + restore `vars` set before the pause. Renaming a workflow via the builder removes the old file/entry instead of leaving an orphaned duplicate (`save(workflow, previousName)`, threaded through the view → IPC → runner RPC → builder hook).

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/core@0.0.12

## 0.0.11

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/core@0.0.11

## 0.0.10

### Patch Changes

- 0326fb0: Harden the runner socket: the socket's parent directory is created/tightened to 0700 before listen (closing the chmod-after-listen window where another local user could connect), socket chmod failures are logged loudly instead of swallowed, and turn aborts are ownership-tracked — a cross-client abort is still allowed (shared-session model) but leaves an audit log naming both connection roles, with `MOXXY_RUNNER_STRICT_ABORT=1` opting into denial. On Windows the named pipe keeps the default DACL (Everyone gets read-only, no write); a one-time warning documents that gap.
- f3c798f: `/new` now truly resets the session everywhere (audit A10). New `session.reset` runner RPC (protocol v3) + optional `SessionLike.reset()` capability: the runner aborts in-flight turns and clears its authoritative event log; the log's new `EventLog.onClear` listeners broadcast a `session.reset` notification so every attached mirror clears in lockstep (re-arming seq-0 ingest instead of silently rejecting all further events) and truncate the persisted session JSONL so wiped history can't resurrect on `--resume` — fixing the same resurrection bug for local `/new`. The TUI and Telegram `/new` paths call `reset()` (falling back to `log.clear()` when the capability is absent) and report an error instead of claiming "history cleared" when the reset RPC fails.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/core@0.0.10
  - @moxxy/sdk@0.8.0

## 0.0.9

### Patch Changes

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

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/core@0.0.9

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/core@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/core@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0
  - @moxxy/core@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0
  - @moxxy/core@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0
  - @moxxy/core@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/core@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/core@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
  - @moxxy/core@0.0.1
