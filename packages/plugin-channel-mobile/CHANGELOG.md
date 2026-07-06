# @moxxy/plugin-channel-mobile

## 0.29.0

### Patch Changes

- 6546a06: Apply the "guard, don't chain" rule across the client-layer, IPC, and channel packages: replaced non-null assertions (`x!`) and depth-2+ optional chains with single-narrowing guard clauses (`assertDefined`/`invariant` from `@moxxy/sdk`, or local guards where `@moxxy/sdk` is not a dependency). Behavior is preserved — genuinely-optional single `?.` reads and silent absence paths are kept; only impossible-by-construction sites became loud throws. No runtime behavior change intended.
- Updated dependencies [6546a06]
- Updated dependencies [2d085b2]
- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/ipc-server-ws@0.1.47
  - @moxxy/desktop-ipc-contract@0.14.5
  - @moxxy/sdk@0.29.0
  - @moxxy/workspace-registry@0.2.17
  - @moxxy/core@0.29.0
  - @moxxy/e2e@0.29.0
  - @moxxy/plugin-tunnel-proxy@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [2da5496]
- Updated dependencies [6c0af71]
  - @moxxy/desktop-ipc-contract@0.14.4
  - @moxxy/sdk@0.28.1
  - @moxxy/ipc-server-ws@0.1.46
  - @moxxy/workspace-registry@0.2.16
  - @moxxy/core@0.28.1
  - @moxxy/e2e@0.28.1
  - @moxxy/plugin-tunnel-proxy@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0
  - @moxxy/core@0.28.0
  - @moxxy/desktop-ipc-contract@0.14.3
  - @moxxy/e2e@0.28.0
  - @moxxy/ipc-server-ws@0.1.45
  - @moxxy/plugin-tunnel-proxy@0.28.0
  - @moxxy/workspace-registry@0.2.15

## 0.27.0

### Patch Changes

- Updated dependencies [87aac6d]
- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [6460cc6]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [e5ea7e6]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [b2a5fba]
- Updated dependencies [fa3922e]
- Updated dependencies [be28d55]
  - @moxxy/core@0.27.0
  - @moxxy/sdk@0.27.0
  - @moxxy/desktop-ipc-contract@0.14.2
  - @moxxy/plugin-tunnel-proxy@0.27.0
  - @moxxy/e2e@0.27.0
  - @moxxy/workspace-registry@0.2.14
  - @moxxy/ipc-server-ws@0.1.44

## 0.26.0

### Patch Changes

- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [ce56ef6]
  - @moxxy/sdk@0.26.0
  - @moxxy/core@0.26.0
  - @moxxy/desktop-ipc-contract@0.14.1
  - @moxxy/e2e@0.1.13
  - @moxxy/ipc-server-ws@0.1.43
  - @moxxy/plugin-tunnel-proxy@0.26.0
  - @moxxy/workspace-registry@0.2.13

## 0.2.14

### Patch Changes

- Updated dependencies [f346b38]
  - @moxxy/desktop-ipc-contract@0.14.0
  - @moxxy/ipc-server-ws@0.1.42
  - @moxxy/workspace-registry@0.2.12
  - @moxxy/sdk@0.25.0
  - @moxxy/core@0.25.0
  - @moxxy/e2e@0.1.12
  - @moxxy/plugin-tunnel-proxy@0.1.12

## 0.2.13

### Patch Changes

- @moxxy/sdk@0.24.1
- @moxxy/core@0.24.1
- @moxxy/desktop-ipc-contract@0.13.3
- @moxxy/e2e@0.1.11
- @moxxy/ipc-server-ws@0.1.41
- @moxxy/plugin-tunnel-proxy@0.1.11
- @moxxy/workspace-registry@0.2.11

## 0.2.12

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0
  - @moxxy/core@0.24.0
  - @moxxy/desktop-ipc-contract@0.13.2
  - @moxxy/e2e@0.1.10
  - @moxxy/ipc-server-ws@0.1.40
  - @moxxy/plugin-tunnel-proxy@0.1.10
  - @moxxy/workspace-registry@0.2.10

## 0.2.11

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0
  - @moxxy/core@0.23.0
  - @moxxy/desktop-ipc-contract@0.13.1
  - @moxxy/e2e@0.1.9
  - @moxxy/ipc-server-ws@0.1.39
  - @moxxy/plugin-tunnel-proxy@0.1.9
  - @moxxy/workspace-registry@0.2.9

## 0.2.10

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0
  - @moxxy/desktop-ipc-contract@0.13.0
  - @moxxy/core@0.22.0
  - @moxxy/e2e@0.1.8
  - @moxxy/ipc-server-ws@0.1.38
  - @moxxy/plugin-tunnel-proxy@0.1.8
  - @moxxy/workspace-registry@0.2.8

## 0.2.9

### Patch Changes

- @moxxy/sdk@0.21.1
- @moxxy/core@0.21.1
- @moxxy/desktop-ipc-contract@0.12.3
- @moxxy/e2e@0.1.7
- @moxxy/ipc-server-ws@0.1.37
- @moxxy/plugin-tunnel-proxy@0.1.7
- @moxxy/workspace-registry@0.2.7

## 0.2.8

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/core@0.21.0
  - @moxxy/desktop-ipc-contract@0.12.2
  - @moxxy/e2e@0.1.6
  - @moxxy/ipc-server-ws@0.1.36
  - @moxxy/plugin-tunnel-proxy@0.1.6
  - @moxxy/workspace-registry@0.2.6

## 0.2.7

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [497e9a1]
- Updated dependencies [bddaa83]
- Updated dependencies [e3491a9]
- Updated dependencies [5c1c334]
- Updated dependencies [238e434]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0
  - @moxxy/core@0.7.0
  - @moxxy/desktop-ipc-contract@0.12.1
  - @moxxy/e2e@0.1.5
  - @moxxy/ipc-server-ws@0.1.35
  - @moxxy/plugin-tunnel-proxy@0.1.5
  - @moxxy/workspace-registry@0.2.5

## 0.2.6

### Patch Changes

- 08f927a: feat: pick which session ambient triggers run in + a compact trigger marker

  Ambient triggers (webhooks, schedules, workflows) used to fire on whichever
  session **created** them, and the synthesized prompt — often a large block
  carrying an untrusted webhook payload — rendered as a giant user bubble. Two
  changes:

  **Pick the target session.** Each trigger can now be pinned to a chosen session
  (where its run executes _and_ displays), decoupled from who created it:

  - `webhook_create` / `schedule_create` take an optional `targetSessionId`
    (defaulting to the creating session), and `webhook_update` /
    `schedule_set_target` reassign it. These map onto the existing
    `ownerSessionId` routing key, so the webhook queue/drain and the scheduler
    owner-gate already deliver to the right runner — no routing change.
  - Workflows gained a top-level `targetSessionId`. Scheduled workflows stamp it
    onto their scheduler mirror row (reusing the owner-gate); `fileChanged` is
    watched only by the target runner; a cross-session `afterWorkflow` dependent
    is skipped with a warning (the completion event is in-process to the parent's
    runner). The visual builder preserves the field across a round-trip.
  - Desktop: the Webhooks / Schedules / Workflows panels and the workflow builder
    gain a session picker (new `*.setTargetSession` IPC commands), and each
    summary surfaces the resolved target-session name.

  **Compact trigger marker.** A fired trigger now renders as a one-line,
  expandable chip ("Webhook received · github-issues", "Schedule fired · daily",
  "Workflow ran · digest") instead of the raw prompt — click to reveal the full
  payload. The prompt still lives in the model's context (security fences intact);
  only the display changes (new optional `origin` on the `user_prompt` event,
  threaded from the fired turn via `RunTurnOptions.origin`).

  Unset everywhere preserves today's behavior; single-process CLI/TUI is
  unaffected.

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/desktop-ipc-contract@0.12.0
  - @moxxy/core@0.6.3
  - @moxxy/e2e@0.1.4
  - @moxxy/ipc-server-ws@0.1.34
  - @moxxy/plugin-tunnel-proxy@0.1.4
  - @moxxy/workspace-registry@0.2.4

## 0.2.5

### Patch Changes

- Updated dependencies [c4b7f1c]
  - @moxxy/desktop-ipc-contract@0.11.0
  - @moxxy/ipc-server-ws@0.1.33
  - @moxxy/workspace-registry@0.2.3

## 0.2.4

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/core@0.6.2
  - @moxxy/desktop-ipc-contract@0.10.6
  - @moxxy/e2e@0.1.3
  - @moxxy/ipc-server-ws@0.1.32
  - @moxxy/plugin-tunnel-proxy@0.1.3
  - @moxxy/workspace-registry@0.2.2

## 0.2.3

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/core@0.6.1
  - @moxxy/desktop-ipc-contract@0.10.5
  - @moxxy/e2e@0.1.2
  - @moxxy/ipc-server-ws@0.1.31
  - @moxxy/plugin-tunnel-proxy@0.1.2
  - @moxxy/workspace-registry@0.2.1

## 0.2.2

### Patch Changes

- 3862cb2: Unify sessions into a single source of truth across TUI / desktop / mobile.

  A session now lives in exactly ONE place — its per-session file
  `~/.moxxy/sessions/<id>.json` (the conversation stays in the append-only
  `<id>.jsonl`). `~/.moxxy/desktop/desks.json` is reduced to a thin workspace
  overlay (desk definitions + active pointers); the per-desk session list is
  DERIVED from the session files at read time and grouped by an explicit `groupId`
  (falling back to cwd for CLI/TUI sessions). Deleting a session = erasing its file,
  so a removed session/workspace can never resurrect — which removes the whole class
  of "deleted workspace comes back after restart" bugs and deletes ~300 lines of
  copy/reconciliation code (`syncSessionIndexIntoRegistry`, `registerSessionFromMeta`,
  partial-resume detection, legacy name hydration, the `withSessionTitles` pass).

  - `@moxxy/core`: the session metadata file (`<id>.json`, versioned) gains
    `source` (originating channel), `groupId` (workspace membership) and `title`
    (user rename). New helpers: `listSessionMetas` (cheap, mtime-cached, single
    `readdir`), `seedSessionMeta`, `setSessionTitle`, `setSessionGroup`. The runner
    adopts a file's stable identity (`startedAt`/`source`) and PRESERVES the
    UI-owned `title`/`groupId` across its writes, so a live runner never clobbers a
    rename/move. `deleteSession` is the single deletion mechanism.
  - `@moxxy/workspace-registry`: derives the desk/session view from the session
    files with an mtime-parse cache; `moveSession` re-homes a session by `groupId`.
  - `@moxxy/desktop-host`: a sessions-dir watcher pushes a debounced (and
    projection-diffed) `desks.changed` so a title/first-prompt/new-session/deletion
    syncs live to desktop + mobile; the desk-removal flow tears runners down before
    erasing files.
  - No migration: pre-existing sessions may be dropped; old desk _definitions_ are
    read in place (their embedded session arrays are ignored).

- Updated dependencies [3862cb2]
  - @moxxy/core@0.6.0
  - @moxxy/workspace-registry@0.2.0
  - @moxxy/ipc-server-ws@0.1.30

## 0.2.1

### Patch Changes

- 648c966: Mobile app: pair through the self-hosted E2E proxy relay. The pairing flow now
  recovers the agent fingerprint from the QR (`?fp=`) and threads it into the
  transport (`makeWsApiHandle({ e2e: { pinnedFingerprint } })`), so a relay QR
  runs the encrypted handshake instead of failing as a plain `ws://` connection;
  LAN pairing is unchanged.

  Add EAS deployment for the Expo app: `eas.json` build/submit profiles, a dynamic
  `app.config.ts` that injects the Expo `owner` + EAS `projectId` from the
  environment (so the account identity is never committed), and a
  `Mobile EAS Build` GitHub Actions workflow driven by repo secrets
  (`EXPO_TOKEN`, `EXPO_OWNER`, `EAS_PROJECT_ID`).

  Remove the retired `apps/mobile-poc` proof-of-concept (superseded by
  `apps/mobile`).

- d5a3014: Fix mobile (iOS) E2E pairing over the proxy relay. The encrypted channel framed
  each ciphertext message as a **binary** WebSocket frame, but React Native's iOS
  WebSocket silently drops binary frames — the phone's `ClientHello` never reached
  the agent shim, so pairing failed with "transport closed during handshake"
  (the relay, proxy, shim and handshake were all correct; a Node `ws` client
  paired fine through the same production relay). The phone client and the agent
  shim now exchange base64url **text** frames (delivered reliably across
  RN/iOS/Android/browser) and still accept binary from a binary-capable peer.
- e5d3ced: Move the bundled Expo app from `apps/mobile-plugin/mobile` to `apps/mobile` and
  point the `moxxy mobile` Expo launcher at the new location. Without this the
  launcher's directory resolver still walked to `apps/mobile-plugin/mobile`, so the
  full app could not be found after the rename. Workspace glob, EAS build workflow,
  docs, and tests were updated to match.
- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/core@0.5.4
  - @moxxy/desktop-ipc-contract@0.10.4
  - @moxxy/e2e@0.1.1
  - @moxxy/ipc-server-ws@0.1.29
  - @moxxy/plugin-tunnel-proxy@0.1.1
  - @moxxy/workspace-registry@0.1.1

## 0.2.0

### Minor Changes

- b19d401: Self-hosted **proxy** tunnel — a private replacement for ngrok/cloudflared.

  A locally-running agent is exposed at `https://<uuid>.proxy.moxxy.ai` via a
  self-hosted relay it dials outbound. Identity is a per-install Ed25519 keypair
  (no account, no login — the headless CLI works): `uuid = base32(sha256(pubkey))`,
  ownership proven by signing a relay challenge. One agent multiplexes several
  local services under its subdomain via path routing (`/mobile`, `/web`,
  `/webhook`).

  The mobile pairing path is **end-to-end encrypted inside the tunnel**
  (`@moxxy/e2e`): the QR carries the agent's public-key fingerprint (`?fp=`), the
  app pins it and runs a signed-ephemeral-ECDH handshake + XChaCha20-Poly1305
  framing, and the bearer token rides encrypted — so the relay (which terminates
  the outer TLS) sees only ciphertext it can neither read nor forge, and cannot
  impersonate the agent.

  The desktop **Settings → Mobile** "Start mobile" toggle now opens the same E2E
  proxy path: enabling the gateway exposes it at `wss://<uuid>.proxy.moxxy.ai/mobile`
  (QR + pinned fingerprint) so a phone can pair from anywhere, not just the same
  Wi-Fi. If the relay is unreachable it falls back to the LAN URL; `MOXXY_MOBILE_NO_PROXY=1`
  forces LAN-only. (`openMobileProxyTunnel` is exported from
  `@moxxy/plugin-channel-mobile/e2e-proxy`, shared by the CLI channel and the desktop.)

  **Breaking (`@moxxy/sdk`):** `proxy` is now the sole tunnel provider —
  `cloudflared`/`ngrok` and the `spawnCliTunnel` / `isCliTunnelAvailable` helpers
  (plus `SpawnCliTunnelOptions` / `CliTunnelHandle`) were removed. `TunnelOpenOptions`
  gains an optional `label` for path-routed multiplexing. The web preview and the
  webhooks listener now expose themselves through the proxy relay; the
  `webhook_tunnel_start` tool no longer takes a `kind`.

  The relay server itself lives in a separate private repo (not published).

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/e2e@0.1.0
  - @moxxy/plugin-tunnel-proxy@0.1.0
  - @moxxy/desktop-ipc-contract@0.10.3
  - @moxxy/ipc-server-ws@0.1.28

## 0.1.28

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/desktop-ipc-contract@0.10.2
  - @moxxy/ipc-server-ws@0.1.27
  - @moxxy/plugin-channel-web@0.0.25

## 0.1.27

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1
  - @moxxy/desktop-ipc-contract@0.10.1
  - @moxxy/ipc-server-ws@0.1.26
  - @moxxy/plugin-channel-web@0.0.24

## 0.1.26

### Patch Changes

- Updated dependencies [f070207]
  - @moxxy/desktop-ipc-contract@0.10.0
  - @moxxy/ipc-server-ws@0.1.25

## 0.1.25

### Patch Changes

- @moxxy/plugin-channel-web@0.0.23
- @moxxy/ipc-server-ws@0.1.24

## 0.1.24

### Patch Changes

- @moxxy/plugin-channel-web@0.0.23
- @moxxy/ipc-server-ws@0.1.23

## 0.1.23

### Patch Changes

- @moxxy/plugin-channel-web@0.0.23
- @moxxy/ipc-server-ws@0.1.22

## 0.1.22

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/desktop-ipc-contract@0.9.4
  - @moxxy/ipc-server-ws@0.1.21
  - @moxxy/plugin-channel-web@0.0.23

## 0.1.21

### Patch Changes

- Updated dependencies [82b8be9]
  - @moxxy/desktop-ipc-contract@0.9.3
  - @moxxy/ipc-server-ws@0.1.20

## 0.1.20

### Patch Changes

- Updated dependencies [72d89f3]
  - @moxxy/desktop-ipc-contract@0.9.2
  - @moxxy/ipc-server-ws@0.1.19

## 0.1.19

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/desktop-ipc-contract@0.9.1
  - @moxxy/ipc-server-ws@0.1.18
  - @moxxy/plugin-channel-web@0.0.22

## 0.1.18

### Patch Changes

- Updated dependencies [f8b0c63]
  - @moxxy/desktop-ipc-contract@0.9.0
  - @moxxy/ipc-server-ws@0.1.17

## 0.1.17

### Patch Changes

- Updated dependencies [c058735]
  - @moxxy/desktop-ipc-contract@0.8.0
  - @moxxy/ipc-server-ws@0.1.16

## 0.1.16

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4
  - @moxxy/ipc-server-ws@0.1.15
  - @moxxy/desktop-ipc-contract@0.7.6
  - @moxxy/plugin-channel-web@0.0.21

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
