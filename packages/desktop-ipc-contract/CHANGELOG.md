# @moxxy/desktop-ipc-contract

## 0.9.0

### Minor Changes

- f8b0c63: feat(collaborative): launch collaborations from the Collaborate tab; one at a time

  Collaboration is no longer started as a chat mode (any chat in a workspace could
  have kicked one off, clobbering the same repo's worktrees). It is launched from
  the Collaborate tab, and only ONE runs at a time across the app to save
  resources.

  - **Global single-flight lock** (`~/.moxxy/collab/active.lock`, cross-process,
    with dead-pid reclaim): the coordinator acquires it before a run and refuses a
    second with a clear message; released in `finally`.
  - **Collaborate tab Start composer** — type a goal → it sets the active
    workspace's session to collaborative mode and runs it; a `＋ New` affordance
    after a run finishes. A new read-only `collab.active` IPC lets the tab disable
    Start (with a notice) while a collaboration runs in any workspace.
  - **Removed from the chat mode pickers** — `collaborative` and the internal
    `collab-architect`/`collab-peer` modes no longer appear in the desktop
    AgentPicker or the TUI `/mode` picker; `/mode collab*` points to `/collab`.
  - chat-model: a refused start no longer leaves an empty collaboration block.

## 0.8.0

### Minor Changes

- c058735: feat(desktop): Apps gallery with install lifecycle + offline document anonymizer

  Adds an **Apps** section (a new top-level header tab next to Chat / Workflows) — a
  registry-backed gallery of self-contained mini-applications. Apps that need local
  assets show a predefined **Install** step that downloads everything they need
  before first use; installation is the only time the network is touched, runs in
  the main process, and is gated behind an explicit click.

  The first app is an **offline document anonymizer**. Paste text or open a
  document (PDF / Office / text, parsed locally via the existing officeparser
  pipeline) and it detects + redacts PII — emails, phone numbers, credit cards
  (Luhn), SSNs, IPs, MACs, IBANs (mod-97), URLs — plus a custom-terms list and an
  **on-device NER** model (`Xenova/bert-base-NER`, ~109 MB, downloaded on install)
  for names, organizations and locations. Redaction runs entirely in the renderer
  (`@moxxy/anonymizer`, a new pure, dependency-free, network-free engine) with
  labeled / pseudonym / hash styles. **Documents never leave the machine**: the
  analyze path touches no provider/runner/network, the CSP `connect-src` stays
  local-only (the NER model is served from a confined `moxxy-app://` scheme over
  `userData/moxxy-apps`), and the engine's emptiness of dependencies is enforced by
  a unit test.

## 0.7.6

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.7.5

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.7.4

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.7.3

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.7.2

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.7.1

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.7.0

### Minor Changes

- 143264a: Desktop OAuth providers now sign in for real instead of showing a "run `moxxy login` in a terminal" hint.

  Settings → Providers (and the onboarding wizard) drive a shared `OAuthSignIn` flow that spawns `moxxy login <provider>`, opens the browser, and — for out-of-band providers like `claude-code` — collects the pasted `claude setup-token` or `code#state` in the UI (browser-authorize primary, token paste as a fallback). Loopback providers (openai-codex) keep their automatic browser+callback flow.

  Mechanics: `moxxy login --stdin-prompts` relays each interactive prompt to the host as a NUL-bracketed marker on stdout (new `encodeLoginPrompt` / `createLoginStreamScanner` in `@moxxy/sdk`) and reads answers as stdin lines, so a GUI host can drive the paste flow without a TTY. The desktop exposes this via new `provider.login.start` / `answer` / `cancel` IPC commands and `provider.login.prompt` / `output` / `done` events; the dead `onboarding.runProviderLogin` command was removed. `onboarding.providerAuthKind` now derives a provider's auth kind from the runner's registry (fixing `claude-code` being mis-detected as an API-key provider) instead of a hardcoded list.

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0

## 0.6.1

### Patch Changes

- c15a45a: "Requires full update" releases now install themselves. New `app.updateShell` IPC drives electron-updater against a generic feed pinned at the exact `desktop-v<version>` release assets (GitHub latest/atom discovery can't parse `desktop-v*` tags), streaming download progress over `app.update.progress` and quit-and-installing on completion; the banner/Settings CTA becomes "Update app" with the release page kept as a fallback once an automatic attempt fails. macOS builds add a `zip` target so Squirrel.Mac can apply them, and desktop releases are no longer marked "Latest" on GitHub (`make_latest: false`).

## 0.6.0

### Minor Changes

- aacdf1d: Desktop: live registry refresh + interactive provider management.

  The runner now broadcasts `info.changed` after every completed turn, so registry changes made by tools inside a conversation (provider_add, mcp_add, workflow_create, skill writes, …) reach attached clients; the desktop forwards the push to the renderer (`session.info.changed` → `SESSION_INFO_REFRESH_EVENT`) and the Settings panel re-fetches live — no more app restart to see an agent-added provider.

  Settings → Providers is now interactive: enable/disable any provider (runner protocol v7 `provider.setEnabled`, persisted to `preferences.json#disabledProviders` and honored by boot's activation walk; disabling the ACTIVE provider is refused), and a Configure sheet sets the API key (vault + live readiness re-probe via `provider.refreshReady`) and, for runtime-registered providers, the stored baseURL/default model (`provider.configure` through the new `SessionLike.providerAdmin` view). OAuth providers get a `moxxy login` hint instead of a key form.

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.5.0

### Minor Changes

- d0e0bd2: Desktop workspaces now hold multiple sessions: desks persist a session list (v1 docs migrate so the first session keeps the desk's id and resumes its existing logs), the runner pool is keyed by session id (one `moxxy serve` per session), new `sessions.list/create/setActive/remove/rename` IPC commands (list/create/setActive/rename remote-allowed for mobile; remove host-only), and the sidebar shows the active desk's sessions with new/rename/delete affordances — `session.newSession` keeps its reset-current semantics. The desktop also gains dark mode (light/dark/system in Settings → Appearance, persisted in prefs, nativeTheme-synced, Clerk modals themed; designed `darkTokens` palette with CI-enforced light/dark parity), the workflow builder becomes a true infinite canvas (pan both axes unbounded, cursor-anchored zoom 10–400%, zoom-to-fit, persisted viewport), and self-update is honest about runner-protocol bumps: such releases report "requires full update" with a release-page link instead of staging a bundle the bootstrap would refuse and claiming success, update diagnostics explain boot-time refusals, and floor boots after a relaunch no longer inherit the previous override's identity.

## 0.4.0

### Minor Changes

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

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.3.0

### Minor Changes

- 00d7425: Desktop mobile gateway: deny-by-default remote command allow-list + gateway hardening.

  **Security fix (critical/high).** The runtime mobile gateway (Settings → Mobile, PR #141) wired the desktop's COMPLETE IPC handler set onto the WebSocket bus and bound the LAN wildcard. The only per-command filter for remote clients was a blocklist that omitted host-mutating commands — so a paired phone (or anyone on the LAN with the bearer token) could invoke `session.setAutoApprove` (disable the desktop's approval prompts, then run any tool unattended), `desks.create`/`rename`/`remove`, `onboarding.saveProviderKey`/`openExternal`, `app.updateCli`/`checkUpdate`/`updateDashboard`, vault/settings/prefs writes, and more — a privilege-escalation / RCE-adjacent hole.

  The model is now **allow-by-default-deny**. `@moxxy/desktop-ipc-contract` exports `REMOTE_ALLOWED_COMMANDS` — the single source of truth for the remote/mobile trust surface (the exact commands a paired chat client needs: session info/runTurn/abort/setMode/newSession/runCommand, transcribe, ask RESPOND, connection discovery/retry, the per-workspace transcript log, and `workflows.list`/`run`/`getRun`). `@moxxy/ipc-server-ws`'s `WebSocketCommandBus` rejects any command not on the list with a coded error, regardless of what handlers the host registered. The Electron (renderer) bus keeps full access — only the WS/remote bus is restricted. `REMOTE_DISALLOWED_COMMANDS` is kept (deprecated) for renderer affordance-gating but no longer drives enforcement.

  **Finding 2 (medium).** Workflow AUTHORING is host-only: `workflows.save`, `workflows.validateDraft`, and `workflows.setEnabled` are NOT on the remote allow-list — a paired phone cannot rewrite or re-enable the host's workflows. Read + run (`list`/`getRun`/`run`) stay allowed.

  **Finding 3 (medium, stability).** `MobileGatewayManager` start/stop/setEnabled/rotate/resume now serialize through a lifecycle lock, so a rapid off→on toggle (or a boot resume racing a user toggle) can't double-bind the port or leak a LAN-bound listener.

  **Finding 4 (medium).** Token rotation is now coherent with a pinned `MOXXY_WS_TOKEN`: rotation is a no-op-with-warning when the env token pins the credential (it can't be rotated from here without diverging the advertised connectUrl from the live accepted token), and `status()`/`connectUrl` always reflect the live accepted token.

  **Finding 5 (medium, security UX).** The Mobile tab warning now states plainly that the connection is unencrypted plain `ws://`, so anyone on the network can passively intercept the pairing token and all traffic without the QR — use only on trusted networks.

  The standalone `moxxy mobile` host (`@moxxy/plugin-channel-mobile`) is its own trust surface (it registers a curated single-session subset) and opts out of the contract allow-list via `new WebSocketCommandBus({ allowedCommands: null })`. The wave-5 hardening (Origin default-deny, bearer subprotocol auth, connection caps, slow-reader eviction) is unchanged and still applies on the runtime-gateway path.

### Patch Changes

- cdc2cc5: Desktop: new Settings → **Mobile** tab to enable a mobile gateway and pair a phone by scanning a QR — the mobile app then drives the desktop host exactly like the TUI does.

  - **Runtime bridge control.** The opt-in WebSocket bridge (`@moxxy/ipc-server-ws`) can now be started and stopped at runtime, not only at boot. A new `MobileGatewayManager` (`apps/desktop/electron/main/ws-bridge.ts`) owns the lifecycle: start (binds the LAN-advertised interface — `0.0.0.0` — so a phone on the same Wi-Fi can reach it), stop (closes the listener + terminates clients), status (running/host/port/token/connectUrl/clientCount), and token rotation (re-keys the live server, dropping every existing client). The on/off preference is persisted to the desktop prefs file (`DesktopPrefs.mobileGatewayEnabled`) so the gateway survives a restart. The env-gated boot path (`MOXXY_WS_BRIDGE=1`) still works for back-compat.
  - **New IPC commands** (`@moxxy/desktop-ipc-contract`, all Zod-validated): `mobileGateway.status`, `mobileGateway.setEnabled(enabled)`, `mobileGateway.rotateToken`, plus a `mobileGateway.changed` event for live status updates. These control the bridge, so they are **host-only** — added to `REMOTE_DISALLOWED_COMMANDS`, the WS bus refuses them so a remote client can never toggle the gateway or read/rotate the pairing token.
  - **The QR payload IS the connect URL** (`ws://host:port/?t=<token>`), built with the mobile-channel's pure pairing helpers (split into `@moxxy/plugin-channel-mobile/pairing` so the desktop main can import them without the tunnel-provider deps). A test imports the shipped app's own `parsePairingQrPayload` and asserts the desktop's `connectUrl` round-trips through it — proving the QR the desktop emits is exactly what the app accepts.
  - **Security:** the gateway is OFF by default and only starts on explicit user action; the LAN bind is the user's opt-in, surfaced with a prominent honest warning in the tab; bearer-token auth via the `Sec-WebSocket-Protocol` subprotocol and Origin default-deny stay in force; token rotation invalidates existing connections.

- e606178: Mobile app port (phase 2a, data layer): the mobile channel's `MobileSessionHost` now serves the full command subset the Expo app drives — `session.setMode` (re-broadcasts the connected phase so clients see the new mode), `session.newSession` (aborts in-flight turns, then `SessionLike.reset()` with a `log.clear()` fallback), `session.runCommand` (the session command registry, channel `'mobile'`), voice (`session.hasTranscriber` probes the transcriber registry; `session.transcribe` runs the active transcriber or fails with the new coded `not-supported` error), and workflows (`workflows.list` returns the typed empty list when the plugin is absent; `workflows.run` fails coded `not-supported`). `session.runTurn` now forwards the new `inlineAttachments` to the session (mobile clients can't reference host paths, so the payload itself crosses the wire).

  Contract additions (all additive): the `not-supported` `MoxxyIpcErrorCode` for capability-absent commands, `RunTurnArgs.inlineAttachments` (SDK `UserPromptAttachment` shape, size/count-bounded in validation), and boundary Zod schemas for `session.runCommand` (closing the audit-flagged gap — it was the one mutating session command without a schema, on desktop too), `workflows.run`, and `workflows.setEnabled`.

- 4a8ec5d: Workflows round-2 correctness: gate the unshippable `awaitInput` resume, make the visual builder work on the desktop, and fix loop/validation correctness.

  **`awaitInput` is gated (was a hang-forever dead-end).** The executor can pause + checkpoint an `awaitInput` step, but the resume trigger/channel that delivers the operator's reply never shipped to `main` — `resumeWorkflowRun` had zero production callers. So an agent-drafted "ask me, then act" workflow would pause forever, leak a retained child session for the process lifetime, and orphan a checkpoint file. `awaitInput` is now **rejected at validate/save time** with a clear "requires the resume channel, not available in this build" message, and `draft.ts` no longer teaches it (it steers the author to `inputs` fields instead). Defense-in-depth: the CLI runner treats a `paused` result as non-terminal (no inbox delivery), `Session.close()` clears retained child sessions so they can't leak, and a `WorkflowRunStore.sweepStale()` sweeper (7-day TTL, run on workflows boot) reaps orphaned `~/.moxxy/workflow-runs/active/` checkpoints. The executor pause/resume path is kept intact so re-enabling is a matter of landing a resume trigger and removing the schema gate.

  **Visual builder works on the desktop now.** The desktop drives a `RemoteSession`, whose workflows view only forwarded `list`/`setEnabled`/`run` — so the builder's `validateDraft`/`save`/`getRun` were `undefined` and threw "not supported on this session". Added a `workflow.validateDraft|save|getRun` runner-RPC family (**protocol bumped to v4**) with RemoteSession client methods + server handlers, so the desktop builder validates/saves/loads against the runner.

  **Loop + validation correctness.** A condition/switch step used as a loop body is rejected (its branch routing was silently ignored). A non-loop-body step that `needs` a loop-body step is rejected (it would stall — body steps are excluded from the main DAG). A loop-body step's own `when` guard and any `needs` other than its loop step / a sibling body step are rejected (body steps run unconditionally each iteration). Logic-step `vars` now drop `__proto__`/`constructor`/`prototype` keys (prototype-pollution guard). Paused-run checkpoints persist + restore `vars` set before the pause. Renaming a workflow via the builder removes the old file/entry instead of leaving an orphaned duplicate (`save(workflow, previousName)`, threaded through the view → IPC → runner RPC → builder hook).

- 6afc4c0: Workflows engine (phase 1 of 2): port the logic-step + agentic-authoring engine onto current main, and add a bounded while-loop node.

  **Engine features ported.** `@moxxy/plugin-workflows` now supports logic steps — `bridge` (extract/transform upstream output into `vars`), `condition` (if/else gate routed by an LLM `{"branch":"then"|"else"}`), and `switch` (multi-way gate routed by case id) — plus a `format: json|plain` field, branch fields (`then`/`else`/`cases`/`default`), a persisted-only `ui.layout` schema (node x/y + viewport, no editor here), agentic YAML authoring (`draft.ts` `buildSystemPrompt`/`draftWorkflow` + the `workflow_create` tool teaching the full schema), LLM branch-predicate parsing (`logic-response.ts`), and `awaitInput` pause/resume for prompt/skill steps (`run-store.ts` checkpoints under `~/.moxxy/workflow-runs/active/` + executor `resumeWorkflowRun`). The DAG executor (`executor/dag.ts`) gains `runLogicStep`, `mergeVars`, `applyBranchSkips`, and an `ExecutorContext`, merged surgically onto main's baseline — main's `MAX_NESTING_DEPTH` guard and behavior are preserved, as is the CLI's separate inter-workflow `afterWorkflow` cycle guard (`MAX_AFTER_WORKFLOW_CHAIN`, Tarjan SCC). The SDK gains the matching types (`WorkflowLoopAction`, `WorkflowLogicStepFormat`, `WorkflowRunStatus`, `WorkflowUi*`, `awaitInput`, `retainSession`, `SubagentContinueArgs`); core's subagent runtime gains retained-session `continue()`/`release()` (new `run-child.ts` + `registry.ts`) backing the pause/resume flow.

  **New `loop` node.** A `loop: { body: string[], condition: string, maxIterations: 1..50 (default 10) }` action repeats its body steps in order each iteration (resetting their state per pass, honoring `onError`), then evaluates `condition` via the same LLM predicate as a `condition` step. `condition` is the loop's EXIT/GOAL condition — the body repeats UNTIL it is met: `then` = condition met → STOP (continue to the next step), `else` = not yet met → run another iteration. A body step error BREAKS the loop to the next step (the loop returns ok with a "broke on error" note rather than failing the whole workflow), unless that body step sets `onError: continue` (which swallows the error and keeps iterating). It is unmistakably safe: it terminates when the exit condition is met, when a body error breaks it, OR at `maxIterations` (finishing with a clear note, never hanging), and composes with `MAX_NESTING_DEPTH` (a body that calls nested workflows still bottoms out at the depth cap). The iteration cap and the depth cap are independent guards; neither can be defeated by the other. Schema rejects loops combined with `then`/`else`/`cases`/`default`, empty bodies, out-of-range `maxIterations`, unresolvable body ids, and `awaitInput` on a loop.

  **IPC for the upcoming visual builder (phase 2).** Additive, capability-detectable commands `workflows.validateDraft` (parse YAML → errors), `workflows.save` (persist a workflow), and `workflows.getRun` (fetch canonical YAML): zod-validated contract + a desktop-host pass-through handler + new optional `WorkflowsView` methods, with the mobile `MobileSessionHost` extended to parity. The visual builder GUI itself is phase 2 (follow-up).

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

## 0.2.2

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

## 0.2.1

### Patch Changes

- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.2.0

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

## 0.1.1

### Patch Changes

- c421ab5: Desktop: make Clerk sign-in work in the packaged app, and add a `moxxy://`
  deep-link.

  Sign-in failed in the packaged build with `prohibited_redirect_url`: the
  renderer was served from `file://`, so clerk-js derived a `file://` OAuth
  redirect, which Clerk rejects (only `http(s)` schemes are allowed). It worked
  in dev only because Vite serves `http://localhost`.

  The packaged renderer is now served from a hardened in-process loopback HTTP
  server (`http://127.0.0.1:<port>`, 127.0.0.1-only, fixed port list, GET/HEAD
  only, path-traversal + Host-header guards, SPA fallback). A loopback origin is
  a Chromium _secure context_ and an allowed OAuth redirect scheme, so the
  existing `clerk.openSignIn()` modal + OAuth popup work as they do on the web.
  The CSP gate now matches the loopback origin (directives unchanged — clerk-js
  still loads from the instance's Frontend API host), the focus widget loads from
  the same origin, and OAuth popups get a clean desktop-Chrome user-agent (no
  Electron/app tokens) to avoid Google's embedded-webview block. If every
  loopback port is taken, it falls back to `file://` (the window still renders).

  Also adds a `moxxy://` custom-protocol deep-link as general-purpose transport
  (single-instance lock + protocol registration + `open-url`/`second-instance`
  capture → a typed `deepLink:received` IPC event, with cold-start links buffered
  and drained via `deepLink:drain` on mount). Nothing routes on it yet — it's the
  plumbing for notification + action links.

  Owner action: add the loopback origins (`http://127.0.0.1` and
  `http://localhost` on the configured ports) to the Clerk dashboard's allowed
  origins / redirect URLs for the production instance.

## 0.1.0

### Minor Changes

- fab0fb4: Update flows: a real `moxxy update`, a TUI "new version" nudge, and observable desktop self-update.

  - **CLI** — new `moxxy update` command: checks the npm registry, detects how the
    CLI was installed (npm/pnpm/yarn/bun, global or local), and runs the matching
    upgrade after a confirm. `--check`/`--dry-run` report-only, `--yes` to skip the
    prompt. Source checkouts get git advice instead of an install.
  - **TUI** — surfaces a newer published `@moxxy/cli` as a one-line, auto-dismissing
    banner and shows the running version in the status line. The check is cached
    (~12h) and fully non-blocking on startup. (Also fixes the `version` prop being
    dropped before it reached the view.)
  - **Desktop self-update** — the previously-silent fall-back-to-the-floor is now
    observable: a persistent boot-decision log under `<userData>/app/boot-log.json`,
    a reason for every gate that rejects a staged bundle, and a Settings → Dashboard
    → Diagnostics readout. The renderer's boot confirmation is hardened (retry +
    reported failure) so a flaky heartbeat can't make the boot-probe revert a
    healthy update. Adds the `app.updateDiagnostics` / `app.bootHeartbeatFailed` IPC.

## 0.0.9

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.0.8

### Patch Changes

- a2d551f: Desktop: resume a workspace's conversation + model context across app
  restarts, and make `/new` actually start a fresh session.

  The desktop owns and kills its `moxxy serve` child on quit, and each launch
  spawned a bare `serve` that minted a brand-new empty session — so the model
  forgot the whole conversation and the transcript collapsed to just the
  post-restart message (the TUI didn't have this because its long-lived daemon
  survives a window close). Now each per-workspace runner is given a sticky
  session id (its desk id) so it resumes `~/.moxxy/sessions/<id>.jsonl` if present
  and starts fresh under that id on first run.

  - New `SetupOptions.sessionId` / `BuildSessionArgs.sessionId`: "resume-if-present"
    (distinct from `resumeSessionId`, which errors when the log is missing — for
    an explicit `moxxy resume <id>`).
  - `serve` reads `MOXXY_SESSION_ID`; the desktop `RunnerSupervisor`/`RunnerPool`
    pass the workspace's desk id through to it.
  - Renderer: the runner replays its FULL history on every attach (and re-attach
    after a reconnect), so the chat runtime now de-dupes ingested events by id
    (`seenIds`, kept in lockstep across live append, replay, and pagination). This
    makes a resumed replay idempotent and also fixes a latent bug where a transient
    reconnect to a still-alive runner could duplicate the transcript.
  - `/new` now works on its own (previously it did nothing in the desktop — only
    `/clear` was handled). It clears the transcript AND resets the runner via a
    new `session.newSession` IPC → `RunnerSupervisor.resetSession()`, which wipes
    the persisted session log and restarts so the model context truly resets and
    doesn't resurrect on the next launch.

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
