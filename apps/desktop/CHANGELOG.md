# @moxxy/desktop

## 0.5.4

### Patch Changes

- d3c1e26: Fix desktop sign-in never creating accounts for new users ("External account not found"). The account-portal recovery net no longer kills the portal's `/sign-in` + `/sign-up` pages — the OAuth sso-callback leg that converts a new-user sign-in into a sign-up runs there — and the renderer now sweeps up any dangling transferable OAuth attempt on boot and completes the sign-up + sign-in itself (`OAuthTransferBridge`), with a `clerk-captcha` mount node so bot-protection challenges can render outside the prebuilt components.
- Updated dependencies [d3c1e26]
- Updated dependencies [1450973]
- Updated dependencies [fee0523]
- Updated dependencies [5ab6c78]
  - @moxxy/desktop-host@0.2.1
  - @moxxy/cli@0.9.0

## 0.5.3

### Patch Changes

- Updated dependencies [54526cc]
  - @moxxy/plugin-channel-mobile@0.1.7
  - @moxxy/cli@0.8.2

## 0.5.2

### Patch Changes

- e2cea1b: The chat transcript sticks to the bottom while the agent streams a reply. If you scroll up, autoscroll pauses and a floating ↓ button appears (with a dot when new content arrives below); clicking it — or scrolling back down yourself — jumps to the latest message and re-enables autoscroll.

## 0.5.1

### Patch Changes

- ef314cb: Sidebar redesign: the WORKSPACES tree is replaced by a Slack-style workspace switcher — a roomy card showing the current workspace (name wraps instead of truncating, with a session count) that opens a dropdown to switch, remove, or create workspaces — and the active workspace's sessions become a flat, full-width list under a "Sessions" header with a [+] button. Row actions (rename/delete) move behind a hover-only ⋯ menu instead of always-visible icons. The Workflows view also gains a "Generate with AI" button — like Skills/MCP/Providers, it opens the ask-moxxy prompt box and the agent builds the workflow in the background via the `workflow_create`/`workflow_validate` tools, refreshing the list on completion. The switcher is text-only (no monogram tiles), and the sidebar can be collapsed/expanded (button in the rail, expand affordance in the main-pane header, Cmd/Ctrl+B, persisted across restarts).

## 0.5.0

### Minor Changes

- d0e0bd2: Desktop workspaces now hold multiple sessions: desks persist a session list (v1 docs migrate so the first session keeps the desk's id and resumes its existing logs), the runner pool is keyed by session id (one `moxxy serve` per session), new `sessions.list/create/setActive/remove/rename` IPC commands (list/create/setActive/rename remote-allowed for mobile; remove host-only), and the sidebar shows the active desk's sessions with new/rename/delete affordances — `session.newSession` keeps its reset-current semantics. The desktop also gains dark mode (light/dark/system in Settings → Appearance, persisted in prefs, nativeTheme-synced, Clerk modals themed; designed `darkTokens` palette with CI-enforced light/dark parity), the workflow builder becomes a true infinite canvas (pan both axes unbounded, cursor-anchored zoom 10–400%, zoom-to-fit, persisted viewport), and self-update is honest about runner-protocol bumps: such releases report "requires full update" with a release-page link instead of staging a bundle the bootstrap would refuse and claiming success, update diagnostics explain boot-time refusals, and floor boots after a relaunch no longer inherit the previous override's identity.

### Patch Changes

- Updated dependencies [d0e0bd2]
  - @moxxy/desktop-host@0.2.0
  - @moxxy/desktop-ipc-contract@0.5.0
  - @moxxy/client-core@0.3.0
  - @moxxy/design-tokens@0.2.0
  - @moxxy/desktop-ui@0.0.3
  - @moxxy/ipc-server-ws@0.1.6
  - @moxxy/plugin-channel-mobile@0.1.6
  - @moxxy/client-platform-web@0.1.5
  - @moxxy/cli@0.8.2

## 0.4.3

### Patch Changes

- 4c594d8: Wave of desktop/mobile fixes. Runner protocol v6 (additive): clients can supply the turn id (`runTurn.turnId`) so renderer per-turn filters actually match — fixing the silently-broken "generate skill with AI" flow and hidden-turn leaks — and `attach` gains a replay policy (`'full' | 'none' | { tail }`) with EventLog rebase so the desktop no longer replays full session history on app start/desk switch (history comes from the paginated NDJSON log). Desktop settings gain a shared "ask moxxy to do it" background-agent modal: the skill generator is refactored onto it and MCP servers and Providers get Add buttons driving `mcp_add_server`/`provider_add`, with permission asks surfaced in-modal (plus a global ask fallback outside the chat view). Subagents now inherit the parent's resolved model: hallucinated model ids warn and fall back, workflow-trigger spawns use the session's last resolved model, and hardcoded model-id fallbacks are gone. Clerk sign-in returns to the app instead of stranding on the hosted My-account page (explicit fallback redirect URLs + a main-process account-portal recovery handler). Workflow canvas: Delete/Backspace removes the selected node and dropping a connector on empty canvas opens an insert-node menu. Mobile: reconnects re-prime the connection store (fixes the deaf "Connected" state after a runner restart), gateway URL commits on blur, the redundant header actions toggle is gone, menu entries are chips, executed tools open a diagnostics panel on tap, and the QR scanner starts scanning immediately.
- Updated dependencies [4c594d8]
  - @moxxy/runner@0.2.0
  - @moxxy/desktop-host@0.1.8
  - @moxxy/cli@0.8.2
  - @moxxy/ipc-server-ws@0.1.5
  - @moxxy/plugin-channel-mobile@0.1.5

## 0.4.2

### Patch Changes

- 35754ad: Fix packaged-app Google sign-in doing nothing (eternal button spinner): clerk-js's prebuilt sign-in buttons run the provider flow as a TOP-FRAME redirect, not a popup, and the navigation lockdown silently blocked it. `lockDownNavigation` gains an explicit `allowOriginPatterns` allow-list; the main window passes the OAuth hosts plus its own loopback serving origins so the frame can round-trip app → provider → Clerk FAPI → back, while everything else (and the focus window entirely) stays blanket-denied. Also adds `challenges.cloudflare.com` to CSP connect-src per Clerk's documented Turnstile requirements so the sign-up captcha can't dead-end.
- Updated dependencies [35754ad]
  - @moxxy/desktop-host@0.1.7

## 0.4.1

### Patch Changes

- ad989eb: Workflow builder UX: the canvas pans by dragging the background (grab cursor; node drag / connection drag / click-to-deselect unaffected), the header controls (Back / validity badge / Save) align to the name/description input row instead of floating centred, and schema validation errors read as plain English anchored to the step — `step "greet": prompt must not be empty` instead of `steps.0.prompt: String must contain at least 1 character(s)` — so the builder can pin them to the offending node card.
- Updated dependencies [ad989eb]
  - @moxxy/cli@0.8.1

## 0.4.0

### Minor Changes

- b5c0f79: Desktop shell: Chat, Workflows and Settings now share one unified 64px header with a Chat|Workflows switcher in the main pane (the sidebar MENU group is gone — only Settings remains there, and picking a workspace returns to chat). The settings tabs moved into the header (right-aligned; the redundant Refresh button is removed). The workflow builder canvas gains zoom (40–200%): a −/100%/+ control cluster plus pinch / ctrl+wheel zooming anchored at the cursor.

## 0.3.0

### Minor Changes

- be7d33a: Workflow builder: the skill and tool name fields are now dropdowns of what the session actually has registered (with an explicit "(not installed)" marker for saved names that no longer exist, an empty-state message when there are no skills/tools, and a free-text fallback while no session is attached). Also fixes the macOS Dock "exec" ghost: the runner and other run-as-node children are spawned via the app's LSUIElement Helper binary, so they no longer register a second Dock icon.

## 0.2.2

### Patch Changes

- cfff99f: Self-heal the terminal "Update needed to continue" (protocol-incompatible) connection screen: when the spawned runner CLI is older than the app, the screen now offers a primary "Update CLI & reconnect" button that updates the bundled CLI in place (via `app.updateCli`) and re-runs the supervisor connect so the now-newer runner attaches cleanly — no hand-running npm. It shows an in-progress state while updating, surfaces failures with the exact manual `npm install --prefix "<userData>/cli" @moxxy/cli@latest` fallback, and when the app is the older side (a CLI update can't help) shows reinstall-the-app guidance instead of an update button.

## 0.2.1

### Patch Changes

- 270a9a1: Fix the desktop release build: bump `FLOOR_RUNNER_PROTOCOL` to 5 to match `RUNNER_PROTOCOL_VERSION` (the workflow.resume bump in #151 raised the runner protocol to 5 but left the desktop floor at 4, so the release-time lockstep assertion in `build-app-bundle.mjs` failed and the desktop release was skipped). Adds a unit test asserting `FLOOR_RUNNER_PROTOCOL === RUNNER_PROTOCOL_VERSION` so a forgotten floor bump fails normal CI instead of only the release.

## 0.2.0

### Minor Changes

- 218359b: fix(desktop): serve the packaged renderer from `https://desktop.moxxy.ai:<port>` so Clerk **production** keys work.

  A Clerk production key (`pk_live_`) is domain-locked: its Frontend API rejects any `Origin` that isn't `moxxy.ai` or a subdomain. The packaged renderer was served from a loopback IP origin (`http://127.0.0.1:<port>`), which a `pk_live_` key can never accept, so packaged sign-in with a production key silently failed.

  The loopback server now serves over **HTTPS** at `https://desktop.moxxy.ai:<port>` (a `moxxy.ai` subdomain that resolves to `127.0.0.1` via DNS, so traffic stays on-box). HTTPS uses a **self-signed cert** minted on first run and cached under `userData` (no key in the repo/bundle); the main process **scope-trusts** it via a session-level `setCertificateVerifyProc` (the reliable mechanism for loopback HTTPS under Electron's network service — `app.on('certificate-error')` does not fire here and is kept only as a fallback), trusting the cert only for that host + a matching fingerprint (not a blanket `ignore-certificate-errors`). The Host allow-list, CSP, and `allowedRedirectOrigins` now include the `desktop.moxxy.ai` origin; the DNS-rebinding guard stays intact for every other host. Dev (Vite + `pk_test_`) and the file:// fallback are unchanged.

  **Owner setup required** (one-time): add a DNS A-record `desktop.moxxy.ai → 127.0.0.1`, and register the four origins `https://desktop.moxxy.ai:{51789,51790,51791,51792}` in the production Clerk instance's allowed origins. See `docs/desktop-clerk-loopback-subdomain.md`.

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

- c050573: Workflow builder canvas: drag-to-connect step wiring. You can now draw the
  dependency DAG directly on the canvas instead of only typing into the
  inspector's NEEDS field — and those connections ARE the workflow's execution
  order (an A→B edge means A runs before B).

  - Each node card gets connection handles: a left INPUT and a right OUTPUT
    (plain `needs`). Condition nodes expose labeled `then`/`else` output handles;
    loop nodes expose an `exit` output handle plus a distinct lower-half "body"
    drop region (upper-half input = the loop's own `needs`).
  - A pointerdown on a HANDLE starts a connection drag (live temp line following
    the cursor); a pointerdown on the card BODY still moves the node. Dropping on
    another node's card dispatches the matching shared op (`connect-needs`,
    `set-branch`, `set-loop-body`, `set-loop-exit`); dropping on empty canvas or
    the source's own card cancels cleanly.
  - Existing edges are interactive: click the edge or its midpoint ✕ to remove the
    dependency (routes through `disconnect-needs` / the relevant set-\* op).
  - Self-connects and cycle-closing connections are refused (the latter with a
    brief inline rejection), so the canvas can't author an invalid DAG.
  - Each node shows its 1-based topological execution order so the flow reads
    source→target.

  workflows-builder: `connectNeeds` now also rejects edges that would create a
  cycle, and exports a pure `wouldCreateCycle(state, from, to)` guard for
  interaction layers to check a gesture before dispatching.

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

- Updated dependencies [218359b]
- Updated dependencies [5ab8629]
- Updated dependencies [2796066]
- Updated dependencies [c050573]
  - @moxxy/desktop-host@0.1.6
  - @moxxy/runner@0.1.0
  - @moxxy/desktop-ipc-contract@0.4.0
  - @moxxy/sdk@0.10.0
  - @moxxy/cli@0.8.0
  - @moxxy/plugin-channel-mobile@0.1.4
  - @moxxy/client-core@0.2.0
  - @moxxy/workflows-builder@0.1.1
  - @moxxy/ipc-server-ws@0.1.4
  - @moxxy/chat-model@0.0.13
  - @moxxy/plugin-stt-whisper-codex@0.0.13
  - @moxxy/plugin-vault@0.0.13
  - @moxxy/client-platform-web@0.1.4

## 0.1.0

### Minor Changes

- cdc2cc5: Desktop: new Settings → **Mobile** tab to enable a mobile gateway and pair a phone by scanning a QR — the mobile app then drives the desktop host exactly like the TUI does.

  - **Runtime bridge control.** The opt-in WebSocket bridge (`@moxxy/ipc-server-ws`) can now be started and stopped at runtime, not only at boot. A new `MobileGatewayManager` (`apps/desktop/electron/main/ws-bridge.ts`) owns the lifecycle: start (binds the LAN-advertised interface — `0.0.0.0` — so a phone on the same Wi-Fi can reach it), stop (closes the listener + terminates clients), status (running/host/port/token/connectUrl/clientCount), and token rotation (re-keys the live server, dropping every existing client). The on/off preference is persisted to the desktop prefs file (`DesktopPrefs.mobileGatewayEnabled`) so the gateway survives a restart. The env-gated boot path (`MOXXY_WS_BRIDGE=1`) still works for back-compat.
  - **New IPC commands** (`@moxxy/desktop-ipc-contract`, all Zod-validated): `mobileGateway.status`, `mobileGateway.setEnabled(enabled)`, `mobileGateway.rotateToken`, plus a `mobileGateway.changed` event for live status updates. These control the bridge, so they are **host-only** — added to `REMOTE_DISALLOWED_COMMANDS`, the WS bus refuses them so a remote client can never toggle the gateway or read/rotate the pairing token.
  - **The QR payload IS the connect URL** (`ws://host:port/?t=<token>`), built with the mobile-channel's pure pairing helpers (split into `@moxxy/plugin-channel-mobile/pairing` so the desktop main can import them without the tunnel-provider deps). A test imports the shipped app's own `parsePairingQrPayload` and asserts the desktop's `connectUrl` round-trips through it — proving the QR the desktop emits is exactly what the app accepts.
  - **Security:** the gateway is OFF by default and only starts on explicit user action; the LAN bind is the user's opt-in, surfaced with a prominent honest warning in the tab; bearer-token auth via the `Sec-WebSocket-Protocol` subprotocol and Origin default-deny stay in force; token rotation invalidates existing connections.

- a1e5df1: Workflows visual builder GUI (phase 2 of 2): a drag-canvas on desktop + an outline editor on mobile, both built on one shared, DOM-free model.

  **New shared model — `@moxxy/workflows-builder`.** A genuinely DOM-free, RN-safe package (zero React, zero DOM, zero node built-ins — proven by the Expo iOS export) that both apps import. It holds: the canvas `BuilderState` + a typed `builderReducer`; pure operations (`addStep`/`removeStep`, `connectNeeds`/`disconnectNeeds`, `setBranchTargets`/`setSwitchCase`, `setLoopBody`/`setLoopExit`/`setLoopConfig`, `moveNode`/`setViewport`/`renameNode`/`updateNode`/`updateMeta`); a `serialize`↔`hydrate` pair that builds a `Workflow` object + `ui.layout` from the canvas and re-derives the node graph (incl. an auto-layout when `ui.layout` is absent); a dependency-free YAML codec scoped to the workflow shape (chosen over the `yaml` package, which reaches for `node:process`, so the RN bundle stays clean — authoritative validation is server-side); and the validate/save bridges that map `workflows.validateDraft` issues back onto the offending nodes. 32 unit tests cover operations, the serialize↔hydrate round-trip (loop body + exit + branches + layout), validation-error mapping, and the loop node's body/exit modeling.

  **The loop node's two-region visual model.** A `loop` node exposes (1) a BODY region — the steps that run inside the loop each iteration, toggled in the inspector and rendered as dashed "body" edges — and (2) a single EXIT edge to the next step, taken when the condition is met OR a body step errors, labeled "on done / error → next". The exit is modeled as the body-excluded step that `needs` the loop, so there's always exactly one exit edge and the on-disk schema is unchanged.

  **Desktop canvas (`apps/desktop/src/workflows/`).** `WorkflowsPanel` becomes a list↔builder switcher (keeping enable/disable + run-now + last-run, adding per-row Edit + New). The builder is a hand-rolled SVG drag-canvas (no react-flow — the graph is ≤40 nodes, so a graph lib's bundle cost wasn't justified): color-coded node cards per step kind, derived `needs`/branch/loop edges with labels, draggable nodes that persist x/y to `ui.layout`, a node inspector (edits each kind's action fields incl. the loop's body/exit/condition/maxIterations), an add-node palette, live validation that decorates the offending node, and Save (`validateDraft`→`save`). 7 testing-library tests.

  **Mobile editor (`apps/mobile/`).** New `app/workflow-edit.tsx` screen + `WorkflowEditor` component + `useWorkflowEditor` hook, consuming the same shared model over the mobile frame bridge (new `buildWorkflowValidateFrame`/`buildWorkflowSaveFrame`/`buildWorkflowDetailFrame`, wired to the `MobileSessionHost` handlers the engine added). v1 is an OUTLINE editor (a node list with the same operations, incl. the loop's body/exit/condition), not a touch-drag canvas — a graphical touch canvas was disproportionate for v1.

  **Shared IPC glue.** `client-core` gains `useWorkflowBuilder` (DOM-free) that drives `workflows.getRun`/`validateDraft`/`save` over the injected transport — the Electron preload bridge on desktop, the WebSocket bridge on mobile — so the validate/save flow is identical across platforms.

### Patch Changes

- 00d7425: Desktop mobile gateway: deny-by-default remote command allow-list + gateway hardening.

  **Security fix (critical/high).** The runtime mobile gateway (Settings → Mobile, PR #141) wired the desktop's COMPLETE IPC handler set onto the WebSocket bus and bound the LAN wildcard. The only per-command filter for remote clients was a blocklist that omitted host-mutating commands — so a paired phone (or anyone on the LAN with the bearer token) could invoke `session.setAutoApprove` (disable the desktop's approval prompts, then run any tool unattended), `desks.create`/`rename`/`remove`, `onboarding.saveProviderKey`/`openExternal`, `app.updateCli`/`checkUpdate`/`updateDashboard`, vault/settings/prefs writes, and more — a privilege-escalation / RCE-adjacent hole.

  The model is now **allow-by-default-deny**. `@moxxy/desktop-ipc-contract` exports `REMOTE_ALLOWED_COMMANDS` — the single source of truth for the remote/mobile trust surface (the exact commands a paired chat client needs: session info/runTurn/abort/setMode/newSession/runCommand, transcribe, ask RESPOND, connection discovery/retry, the per-workspace transcript log, and `workflows.list`/`run`/`getRun`). `@moxxy/ipc-server-ws`'s `WebSocketCommandBus` rejects any command not on the list with a coded error, regardless of what handlers the host registered. The Electron (renderer) bus keeps full access — only the WS/remote bus is restricted. `REMOTE_DISALLOWED_COMMANDS` is kept (deprecated) for renderer affordance-gating but no longer drives enforcement.

  **Finding 2 (medium).** Workflow AUTHORING is host-only: `workflows.save`, `workflows.validateDraft`, and `workflows.setEnabled` are NOT on the remote allow-list — a paired phone cannot rewrite or re-enable the host's workflows. Read + run (`list`/`getRun`/`run`) stay allowed.

  **Finding 3 (medium, stability).** `MobileGatewayManager` start/stop/setEnabled/rotate/resume now serialize through a lifecycle lock, so a rapid off→on toggle (or a boot resume racing a user toggle) can't double-bind the port or leak a LAN-bound listener.

  **Finding 4 (medium).** Token rotation is now coherent with a pinned `MOXXY_WS_TOKEN`: rotation is a no-op-with-warning when the env token pins the credential (it can't be rotated from here without diverging the advertised connectUrl from the live accepted token), and `status()`/`connectUrl` always reflect the live accepted token.

  **Finding 5 (medium, security UX).** The Mobile tab warning now states plainly that the connection is unencrypted plain `ws://`, so anyone on the network can passively intercept the pairing token and all traffic without the QR — use only on trusted networks.

  The standalone `moxxy mobile` host (`@moxxy/plugin-channel-mobile`) is its own trust surface (it registers a curated single-session subset) and opts out of the contract allow-list via `new WebSocketCommandBus({ allowedCommands: null })`. The wave-5 hardening (Origin default-deny, bearer subprotocol auth, connection caps, slow-reader eviction) is unchanged and still applies on the runtime-gateway path.

- 01a509b: Replace the logo on the desktop cold-start splash and loading screen with a plain ring spinner. The brand mark read poorly blown up on those large, empty surfaces; a neutral brand-pink ring is cleaner. The load-bearing `#splash-fallback` element (the self-update boot-probe health signal) is unchanged — only the visual inside it.
- Updated dependencies [1e4ed09]
- Updated dependencies [00d7425]
- Updated dependencies [cdc2cc5]
- Updated dependencies [e606178]
- Updated dependencies [a1e5df1]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/plugin-vault@0.0.12
  - @moxxy/desktop-host@0.1.5
  - @moxxy/desktop-ipc-contract@0.3.0
  - @moxxy/ipc-server-ws@0.1.3
  - @moxxy/plugin-channel-mobile@0.1.3
  - @moxxy/workflows-builder@0.1.0
  - @moxxy/client-core@0.1.3
  - @moxxy/runner@0.0.12
  - @moxxy/cli@0.7.3
  - @moxxy/chat-model@0.0.12
  - @moxxy/plugin-stt-whisper-codex@0.0.12
  - @moxxy/client-platform-web@0.1.3

## 0.0.35

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/cli@0.7.2
  - @moxxy/desktop-host@0.1.4
  - @moxxy/chat-model@0.0.11
  - @moxxy/client-core@0.1.2
  - @moxxy/desktop-ipc-contract@0.2.2
  - @moxxy/ipc-server-ws@0.1.2
  - @moxxy/plugin-stt-whisper-codex@0.0.11
  - @moxxy/plugin-vault@0.0.11
  - @moxxy/runner@0.0.11
  - @moxxy/client-platform-web@0.1.2

## 0.0.34

### Patch Changes

- 95222e1: Fix packaged-app boot crash: bundle `@moxxy/ipc-server-ws` into the main-process output and load it lazily.

  PR #120 added a top-level static import of `@moxxy/ipc-server-ws` to the Electron main but never added the package to `BUNDLED_WORKSPACE_DEPS`, so `externalizeDepsPlugin` left a bare specifier in `dist-electron/main/index.js` that cannot resolve in the packaged app (electron-builder ships only `dist`/`dist-electron`, no node_modules). Every packaged 0.0.33 build — and the Tier-1 hot-update bundle built from the same tree — crashed at main-process load with MODULE_NOT_FOUND, which would also have re-poisoned self-update overrides.

  Two-layer fix: `@moxxy/ipc-server-ws` is now in `BUNDLED_WORKSPACE_DEPS` (with `ws`'s optional native accelerators `bufferutil`/`utf-8-validate` kept external — `ws` falls back to JS implementations), and the bridge is loaded via a guarded dynamic `import()` only when `MOXXY_WS_BRIDGE=1` (the shell-updater pattern), so the opt-in bridge can never take down boot again. Verified on a real packaged build: boots clean, and with `MOXXY_WS_BRIDGE=1` the bridge listens.

- 0326fb0: Harden the desktop/mobile WebSocket bridge (2026-06-09 audit, wave 5):

  - Reject browser-Origin upgrades unless allow-listed (`allowedOrigins`, default deny; native clients are unaffected).
  - Move the pairing token out of the URL: `Authorization: Bearer` or a `Sec-WebSocket-Protocol` bearer entry are the supported presentations; the legacy `?t=` query is opt-in (`allowQueryToken`, kept on only for the mobile channel's already-paired apps). The QR still carries the token, but the app strips it before connecting.
  - Token rotation end to end: `rotateChannelToken` (sdk, persisted with `createdAt` + 90-day staleness warning), `rotateAuthToken` on the live server (drops existing connections), `rotateWsBridgeToken` (desktop) and `MobileChannel.rotateToken`.
  - Backpressure + lifecycle: connection cap (default 8), slow-reader eviction (backlog above 4 MB past a 10s grace terminates the socket), and `close()` now terminates clients so desktop quit doesn't burn its shutdown timeout.
  - `WsRpcClient` no longer replays abandoned requests after reconnect (outbox cleared, queued requests rejected on disconnect) and stops reconnecting after a capped exponential backoff, surfacing a terminal `disconnected` status.
  - Hygiene: empty `MOXXY_WS_PORT` no longer binds an ephemeral port, the server reports the actually-bound port, and the desktop bridge reuses the shared sdk token persistence (userData location kept).

- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
- Updated dependencies [05d643a]
- Updated dependencies [2e4bc37]
- Updated dependencies [05d643a]
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [2e4bc37]
- Updated dependencies [f297da0]
- Updated dependencies [0326fb0]
  - @moxxy/cli@0.7.1
  - @moxxy/sdk@0.8.0
  - @moxxy/desktop-host@0.1.3
  - @moxxy/plugin-vault@0.0.10
  - @moxxy/runner@0.0.10
  - @moxxy/ipc-server-ws@0.1.1
  - @moxxy/chat-model@0.0.10
  - @moxxy/client-core@0.1.1
  - @moxxy/desktop-ipc-contract@0.2.1
  - @moxxy/plugin-stt-whisper-codex@0.0.10
  - @moxxy/client-platform-web@0.1.1

## 0.0.33

### Patch Changes

- 5fcaaa7: Fix desktop self-update failing to load every override ("Cannot use import
  statement outside a module").

  The hot-update bundle ships only `dist/**` + `dist-electron/**`, so a staged
  bundle under `<userData>/app/<version>/` had **no `package.json` above its
  main**. The real main (`dist-electron/main/index.js`) is emitted as an ES module
  (`import` syntax), and Electron's bundled Node (v20, no ESM syntax
  auto-detection) decides ESM-vs-CJS from the nearest `package.json#type` — with
  none reachable it defaults to CommonJS and the bootstrap's `import()` threw
  `Cannot use import statement outside a module`. Every staged version
  (0.0.28/29/31/32) loaded this way got poisoned and the app silently reverted to
  the baked floor. The floor itself loads fine only because the packaged `.app`
  carries the desktop `package.json` (`"type":"module"`).

  `buildAppBundle` now ships a minimal `{"type":"module"}` `package.json` at the
  bundle root (signed into the bundle), and the stager writes the same marker at
  extract time when a bundle lacks one — so already-published bundles are also
  rescued on re-stage. The single marker is sourced from one constant shared by
  the producer and the stager so they can't drift.

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

- Updated dependencies [5fcaaa7]
- Updated dependencies [85f9b91]
  - @moxxy/desktop-host@0.1.2
  - @moxxy/sdk@0.7.0
  - @moxxy/desktop-ipc-contract@0.2.0
  - @moxxy/client-core@0.1.0
  - @moxxy/client-platform-web@0.1.0
  - @moxxy/ipc-server-ws@0.1.0
  - @moxxy/design-tokens@0.1.0
  - @moxxy/cli@0.7.0
  - @moxxy/runner@0.0.9
  - @moxxy/chat-model@0.0.9
  - @moxxy/plugin-stt-whisper-codex@0.0.9
  - @moxxy/plugin-vault@0.0.9

## 0.0.32

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

- Updated dependencies [c421ab5]
  - @moxxy/desktop-ipc-contract@0.1.1
  - @moxxy/desktop-host@0.1.1

## 0.0.31

### Patch Changes

- 4c997f6: Fix desktop self-update never sticking ("downloads but stays on the old version").

  The boot-probe required the renderer's `app.appBooted` IPC heartbeat to land within
  15s to mark a hot-updated bundle healthy; in packaged builds that heartbeat doesn't
  reliably land, so the probe poisoned **every** healthy update and reverted to the
  floor (confirmed from on-disk state: `bad.json` had poisoned every staged version and
  `confirmed.json` never existed). The probe now confirms a healthy render from the
  **main process** by inspecting the renderer DOM — `index.html` ships a static
  `#splash-fallback` inside `#root` that React replaces on mount, so its absence is a
  renderer-cooperation-free health signal. The IPC heartbeat is kept only as a fast
  path; a genuine white-screen (never renders) is still poisoned and reverted.

## 0.0.30

### Patch Changes

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

- Updated dependencies [fab0fb4]
  - @moxxy/cli@0.6.0
  - @moxxy/desktop-ipc-contract@0.1.0
  - @moxxy/desktop-host@0.1.0

## 0.0.29

### Patch Changes

- e9ef74d: Desktop: fix sign-in doing nothing with a production (`pk_live_`) Clerk key.

  The packaged app's CSP and OAuth-popup allow-list only permitted Clerk's
  dev/test hosts (`*.clerk.accounts.dev` / `*.clerk.com`). A production
  publishable key serves clerk-js from the instance's OWN Frontend API domain
  (encoded in the key, e.g. `clerk.<your-domain>`), so the script was
  CSP-blocked, clerk-js never initialised, and `clerk.openSignIn()` silently
  rendered no modal.

  The Frontend API host is now decoded from the publishable key and folded into
  the CSP (`script-src`/`connect-src`/`frame-src`/`img-src`) plus the OAuth popup
  allow-list. The key is baked into the main bundle via electron-vite `define`
  (the renderer already read it via `import.meta.env`). Test keys are unaffected.

- Updated dependencies [e9ef74d]
  - @moxxy/desktop-host@0.0.10

## 0.0.28

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/chat-model@0.0.8
  - @moxxy/cli@0.5.5
  - @moxxy/desktop-host@0.0.9
  - @moxxy/desktop-ipc-contract@0.0.9
  - @moxxy/plugin-stt-whisper-codex@0.0.8
  - @moxxy/plugin-vault@0.0.8
  - @moxxy/runner@0.0.8

## 0.0.27

### Patch Changes

- cc62060: Stop the desktop chat-log from growing without bound on every restart. The runner
  replays a conversation's full event history to the renderer on each attach, and the
  renderer re-appended every replayed event to its NDJSON mirror
  (`~/.moxxy/chats/<workspace>.jsonl`), so the file grew by a complete copy of the
  conversation per restart — which also shifted `loadSegment`'s line-index cursors and
  corrupted scroll-up pagination. `appendEvents` is now idempotent by event id, so the
  log keeps exactly one copy and its pagination cursors stay stable.

## 0.0.26

### Patch Changes

- Updated dependencies [9a789fe]
  - @moxxy/cli@0.5.4

## 0.0.25

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

- Updated dependencies [a2d551f]
  - @moxxy/cli@0.5.3
  - @moxxy/desktop-host@0.0.8
  - @moxxy/desktop-ipc-contract@0.0.8

## 0.0.24

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/cli@0.5.2
  - @moxxy/chat-model@0.0.7
  - @moxxy/desktop-host@0.0.7
  - @moxxy/desktop-ipc-contract@0.0.7
  - @moxxy/plugin-stt-whisper-codex@0.0.7
  - @moxxy/plugin-vault@0.0.7
  - @moxxy/runner@0.0.7

## 0.0.23

### Patch Changes

- Updated dependencies [fad9d6b]
  - @moxxy/cli@0.5.1

## 0.0.22

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
- Updated dependencies [2615cbf]
  - @moxxy/cli@0.5.0
  - @moxxy/sdk@0.5.0
  - @moxxy/chat-model@0.0.6
  - @moxxy/desktop-host@0.0.6
  - @moxxy/desktop-ipc-contract@0.0.6
  - @moxxy/plugin-stt-whisper-codex@0.0.6
  - @moxxy/plugin-vault@0.0.6
  - @moxxy/runner@0.0.6

## 0.0.21

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/cli@0.4.0
  - @moxxy/sdk@0.4.0
  - @moxxy/chat-model@0.0.5
  - @moxxy/desktop-host@0.0.5
  - @moxxy/desktop-ipc-contract@0.0.5
  - @moxxy/plugin-stt-whisper-codex@0.0.5
  - @moxxy/plugin-vault@0.0.5
  - @moxxy/runner@0.0.5

## 0.0.20

### Patch Changes

- f75a85f: Fix self-update never taking effect: the immutable bootstrap read
  `app.getPath('userData')` before `app.setName('MoxxyAI Workspaces')` ran (that
  call lives in the later-loaded `index.js`). In a packaged build Electron derives
  `getName()` from the package `name` (`@moxxy/desktop`), not electron-builder's
  `productName`, so the loader looked for staged updates under a different userData
  directory than the one the updater writes to — making every downloaded update
  invisible and silently booting the baked floor instead. The bootstrap now sets
  the app name before resolving `userData`, so it and the updater agree. (Takes
  effect after one fresh installer; subsequent hot-updates then apply.)

## 0.0.19

### Patch Changes

- a2087c0: Desktop: redesign sign-in, loading, focus mode, and onboarding; add one-click Node install.

  - **Sign-in** now opens Clerk's own modal from the sidebar profile pill — the
    dedicated onboarding "Sign in" step and the heavily-customized embedded
    `<SignIn>` are gone. The pill shows only **Sign in** or your profile (no more
    "Guest" state).
  - **Loading screen:** the connecting screen is now a friendly, branded surface
    on the app's near-white background (continuous with the splash and chat) — no
    more greyish "Starting moxxy serve…" with socket/pid rows. Failures show a
    short message + Retry with the diagnostics tucked behind a "Technical details"
    disclosure.
  - **Focus widget:** the mini-text panel is drag-resizable, renders the full
    latest message as scrollable Markdown, and stopping a voice recording now
    opens the panel to show the transcript + streaming answer.
  - **Onboarding:** refreshed two-column look (near-white pane, lighter step rail)
    plus a one-click **"Install automatically"** button that downloads the
    official Node LTS into the app's data dir — no admin or package manager — with
    the manual nodejs.org download as a fallback.
  - Swapped the moxxy loader/avatar animation.

## 0.0.18

### Patch Changes

- f7c236a: fix(desktop): a hot-update that failed to boot once could never be installed
  again. The bootstrap poisons a bundle version (adds it to `bad.json`) when its
  renderer doesn't confirm a healthy mount in time, but nothing ever cleared that
  mark — so every later "download + restart" re-staged the same version,
  `resolveActiveBundle` rejected it as poisoned, and the app silently fell back to
  the packaged floor ("downloads, but restart still shows the old version").
  `downloadAndStage` now clears the poison mark for the version it installs, since
  an explicit user (re)install is a deliberate retry; the boot-probe still
  re-poisons a genuinely broken bundle, so this only ever grants one fresh attempt.

## 0.0.17

### Patch Changes

- 0dad297: chore(ci): collapse the release pipeline into one changeset-driven workflow.
  The desktop installers now build + ship as gated jobs inside `release.yml`
  (folding in `release-desktop.yml`), removing the auto-PR machine and the
  cross-workflow dispatch. `@moxxy/cli` is now a declared desktop dependency, so a
  CLI/SDK release cascades a patch bump and cuts a desktop release automatically.
  A `Changeset present` CI job now fails any PR that lacks a changeset (use
  `pnpm changeset --empty` for no-release changes).

## 0.0.16

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0
  - @moxxy/chat-model@0.0.4
  - @moxxy/desktop-host@0.0.4
  - @moxxy/desktop-ipc-contract@0.0.4
  - @moxxy/plugin-stt-whisper-codex@0.0.4
  - @moxxy/plugin-vault@0.0.4
  - @moxxy/runner@0.0.4

## 0.0.7

### Patch Changes

- Fix voice transcription returning "No speech detected": grant the renderer microphone access (macOS `NSMicrophoneUsageDescription` + audio-input entitlement + a media permission handler that triggers the system mic prompt), since macOS otherwise hands `getUserMedia` a silent stream. A captured-but-silent clip now reports an actionable microphone-access message instead.

## 0.0.6

### Minor Changes

- Self-update: the desktop now hot-updates its JS layers (renderer + main + preload + IPC contract) as one Ed25519-signed app bundle, activated by an immutable bootstrap loader — no reinstall. Rare native/Electron bumps fall back to electron-updater (Tier 2). Signature + SHA-256 + host-pin verified in the immutable floor; a boot-probe reverts a bundle that fails to render. See `docs/desktop-self-update.md`.

## 0.0.5

### Patch Changes

- 6dea644: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.0.4

### Patch Changes

- f3e3f1e: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/chat-model@0.0.3
  - @moxxy/desktop-host@0.0.3
  - @moxxy/desktop-ipc-contract@0.0.3
  - @moxxy/plugin-stt-whisper-codex@0.0.3
  - @moxxy/plugin-vault@0.0.3
  - @moxxy/runner@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/chat-model@0.0.2
  - @moxxy/desktop-host@0.0.2
  - @moxxy/desktop-ipc-contract@0.0.2
  - @moxxy/plugin-stt-whisper-codex@0.0.2
  - @moxxy/plugin-vault@0.0.2
  - @moxxy/runner@0.0.2
