# @moxxy/desktop-host

## 0.1.2

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

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/desktop-ipc-contract@0.2.0
  - @moxxy/runner@0.0.9
  - @moxxy/plugin-stt-whisper-codex@0.0.9
  - @moxxy/plugin-vault@0.0.9

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

- Updated dependencies [c421ab5]
  - @moxxy/desktop-ipc-contract@0.1.1

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

### Patch Changes

- Updated dependencies [fab0fb4]
  - @moxxy/desktop-ipc-contract@0.1.0

## 0.0.10

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

## 0.0.9

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/desktop-ipc-contract@0.0.9
  - @moxxy/plugin-stt-whisper-codex@0.0.8
  - @moxxy/plugin-vault@0.0.8
  - @moxxy/runner@0.0.8

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

- Updated dependencies [a2d551f]
  - @moxxy/desktop-ipc-contract@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/desktop-ipc-contract@0.0.7
  - @moxxy/plugin-stt-whisper-codex@0.0.7
  - @moxxy/plugin-vault@0.0.7
  - @moxxy/runner@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0
  - @moxxy/desktop-ipc-contract@0.0.6
  - @moxxy/plugin-stt-whisper-codex@0.0.6
  - @moxxy/plugin-vault@0.0.6
  - @moxxy/runner@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0
  - @moxxy/desktop-ipc-contract@0.0.5
  - @moxxy/plugin-stt-whisper-codex@0.0.5
  - @moxxy/plugin-vault@0.0.5
  - @moxxy/runner@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0
  - @moxxy/desktop-ipc-contract@0.0.4
  - @moxxy/plugin-stt-whisper-codex@0.0.4
  - @moxxy/plugin-vault@0.0.4
  - @moxxy/runner@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/desktop-ipc-contract@0.0.3
  - @moxxy/plugin-stt-whisper-codex@0.0.3
  - @moxxy/plugin-vault@0.0.3
  - @moxxy/runner@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/desktop-ipc-contract@0.0.2
  - @moxxy/plugin-stt-whisper-codex@0.0.2
  - @moxxy/plugin-vault@0.0.2
  - @moxxy/runner@0.0.2
