# @moxxy/desktop-host

## 0.11.1

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0
  - @moxxy/core@0.23.0
  - @moxxy/desktop-ipc-contract@0.13.1
  - @moxxy/mode-collaborative@0.7.13
  - @moxxy/plugin-scheduler@0.1.5
  - @moxxy/plugin-stt-whisper-codex@0.0.35
  - @moxxy/plugin-vault@0.0.35
  - @moxxy/plugin-webhooks@0.2.5
  - @moxxy/runner@0.2.26
  - @moxxy/workspace-registry@0.2.9

## 0.11.0

### Minor Changes

- f980349: Run Slack & Telegram channels from the desktop, each on its own dedicated runner.

  - **Apps → Channels** (new sub-tab): per channel, enter its secrets (stored in
    the vault), Start/Stop its dedicated-runner subprocess, and — for Slack — copy
    the public Request URL to paste into the Slack app once its proxy tunnel opens.
    The channel runs as a separate isolated session, so its conversation is
    intentionally not shown in the workspace sidebar; the panel manages the runner.
  - New IPC: `channels.list` / `channels.saveConfig` / `channels.start` /
    `channels.stop` + a `channels.status` event (host-only — NOT remote-reachable).
    A `ChannelSupervisor` in `@moxxy/desktop-host` spawns `moxxy <channel>` with
    `MOXXY_DEDICATED_RUNNER=1`, supervises it, and reads the channel's status file
    for the Request URL. Secrets are written to the same in-process vault the runner
    reads, keyed by the names each channel plugin uses (a small static catalog).
  - A dedicated channel runner now publishes a tiny status file
    (`~/.moxxy/channel-<name>.status.json`) with its pid + public ingest URL while
    running, removed on shutdown — so a supervisor can observe it without the runner
    protocol. New `@moxxy/sdk/server` helpers (`writeChannelStatus` /
    `readChannelStatus` / `clearChannelStatus`) + an optional `Channel.requestUrl`
    getter back this.

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0
  - @moxxy/desktop-ipc-contract@0.13.0
  - @moxxy/core@0.22.0
  - @moxxy/mode-collaborative@0.7.12
  - @moxxy/plugin-scheduler@0.1.4
  - @moxxy/plugin-stt-whisper-codex@0.0.34
  - @moxxy/plugin-vault@0.0.34
  - @moxxy/plugin-webhooks@0.2.4
  - @moxxy/runner@0.2.25
  - @moxxy/workspace-registry@0.2.8

## 0.10.5

### Patch Changes

- @moxxy/sdk@0.21.1
- @moxxy/core@0.21.1
- @moxxy/desktop-ipc-contract@0.12.3
- @moxxy/mode-collaborative@0.7.11
- @moxxy/plugin-scheduler@0.1.3
- @moxxy/plugin-stt-whisper-codex@0.0.33
- @moxxy/plugin-vault@0.0.33
- @moxxy/plugin-webhooks@0.2.3
- @moxxy/runner@0.2.24
- @moxxy/workspace-registry@0.2.7

## 0.10.4

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/core@0.21.0
  - @moxxy/desktop-ipc-contract@0.12.2
  - @moxxy/mode-collaborative@0.7.10
  - @moxxy/plugin-scheduler@0.1.2
  - @moxxy/plugin-stt-whisper-codex@0.0.32
  - @moxxy/plugin-vault@0.0.32
  - @moxxy/plugin-webhooks@0.2.2
  - @moxxy/runner@0.2.23
  - @moxxy/workspace-registry@0.2.6

## 0.10.3

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
  - @moxxy/mode-collaborative@0.7.9
  - @moxxy/plugin-scheduler@0.1.1
  - @moxxy/plugin-stt-whisper-codex@0.0.31
  - @moxxy/plugin-vault@0.0.31
  - @moxxy/plugin-webhooks@0.2.1
  - @moxxy/runner@0.2.22
  - @moxxy/workspace-registry@0.2.5

## 0.10.2

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
  - @moxxy/plugin-webhooks@0.2.0
  - @moxxy/plugin-scheduler@0.1.0
  - @moxxy/desktop-ipc-contract@0.12.0
  - @moxxy/core@0.6.3
  - @moxxy/mode-collaborative@0.7.8
  - @moxxy/plugin-stt-whisper-codex@0.0.30
  - @moxxy/plugin-vault@0.0.30
  - @moxxy/runner@0.2.21
  - @moxxy/workspace-registry@0.2.4

## 0.10.1

### Patch Changes

- 4c9a621: fix(desktop): app failed to start after the Apps Webhooks panel (#338)

  #338 registered the webhooks IPC with a static top-level
  `import … from '@moxxy/plugin-webhooks'` in `@moxxy/desktop-host`, which is
  bundled into the Electron main entry (`BUNDLED_WORKSPACE_DEPS`). That dragged
  the webhooks plugin's proxy/E2E stack and, transitively, `ulid` into the main
  entry's eager module graph, reordering ESM init so `ulid` initialised before
  electron-vite's injected `require` shim. `ulid` then threw "secure crypto
  unusable, insecure Math.random not allowed" at boot, so the updated bundle
  (0.23.0) load-errored and fell back to the floor — the identical regression the
  0.22.3 mobile-proxy fix addressed.

  Fix: defer the webhooks plugin to a lazy `import()` inside the IPC handlers
  (only the erased `import type` stays static), so the proxy/E2E stack + `ulid`
  load on the first `webhooks.*` call — post `app.whenReady`, out of the startup
  path. App startup is restored; the Webhooks panel is unchanged.

## 0.10.0

### Minor Changes

- c4b7f1c: Desktop: declutter the composer toolbar and turn Apps into the ambient-automation hub.

  **Composer toolbar**

  - **Mode** moves into the `+` overflow as a disclosure submenu (`Mode: default ▸` → the mode list, active one checked), so it no longer takes a top-level chip.
  - **Model** moves to the right of the toolbar as a quiet, borderless label (the active model name, provider as fallback) instead of a chip button. Clicking it opens a combined **Model & context** panel — the provider/model picker on top, the context-window usage + one-click compaction below — replacing the separate model chip and context meter.

  **Top navigation + Apps**

  - The top-level switcher is now **Chat · Collaborate · Apps** — the separate **Actions** tab is gone; its Workflows / Schedules / Webhooks grouping moves into Apps.
  - The **Apps** view keeps the installable-app gallery as its landing and gains a right-aligned sub-nav: **Workflows · Schedules · Webhooks**. Each chip swaps the body to that surface; re-clicking the active chip returns to the gallery.
    - Workflows / Schedules reuse the existing embedded panels.
    - **Webhooks** is upgraded from the previous stage-1 placeholder (which only listed webhook-triggered workflows) to a real panel backed by new host-only `webhooks.list` / `webhooks.setEnabled` / `webhooks.delete` IPC, which read the shared webhooks store directly (so triggers created from chat appear) with verification secrets redacted at the boundary.

### Patch Changes

- Updated dependencies [c4b7f1c]
  - @moxxy/desktop-ipc-contract@0.11.0
  - @moxxy/workspace-registry@0.2.3

## 0.9.2

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/core@0.6.2
  - @moxxy/desktop-ipc-contract@0.10.6
  - @moxxy/mode-collaborative@0.7.7
  - @moxxy/plugin-scheduler@0.0.29
  - @moxxy/plugin-stt-whisper-codex@0.0.29
  - @moxxy/plugin-vault@0.0.29
  - @moxxy/runner@0.2.20
  - @moxxy/workspace-registry@0.2.2

## 0.9.1

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/core@0.6.1
  - @moxxy/desktop-ipc-contract@0.10.5
  - @moxxy/mode-collaborative@0.7.6
  - @moxxy/plugin-scheduler@0.0.28
  - @moxxy/plugin-stt-whisper-codex@0.0.28
  - @moxxy/plugin-vault@0.0.28
  - @moxxy/runner@0.2.19
  - @moxxy/workspace-registry@0.2.1

## 0.9.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [3862cb2]
  - @moxxy/core@0.6.0
  - @moxxy/workspace-registry@0.2.0
  - @moxxy/mode-collaborative@0.7.5
  - @moxxy/runner@0.2.18

## 0.8.5

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/core@0.5.4
  - @moxxy/desktop-ipc-contract@0.10.4
  - @moxxy/mode-collaborative@0.7.4
  - @moxxy/plugin-scheduler@0.0.27
  - @moxxy/plugin-stt-whisper-codex@0.0.27
  - @moxxy/plugin-vault@0.0.27
  - @moxxy/runner@0.2.17
  - @moxxy/workspace-registry@0.1.1

## 0.8.4

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/core@0.5.3
  - @moxxy/desktop-ipc-contract@0.10.3
  - @moxxy/mode-collaborative@0.7.3
  - @moxxy/plugin-stt-whisper-codex@0.0.26
  - @moxxy/plugin-vault@0.0.26
  - @moxxy/runner@0.2.16

## 0.8.3

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/core@0.5.2
  - @moxxy/desktop-ipc-contract@0.10.2
  - @moxxy/mode-collaborative@0.7.2
  - @moxxy/plugin-stt-whisper-codex@0.0.25
  - @moxxy/plugin-vault@0.0.25
  - @moxxy/runner@0.2.15

## 0.8.2

### Patch Changes

- e762d40: Desktop apps can send their output back to the active session instead of copy+paste. New shared `sendToSession()` + `composerDraftStore` in `@moxxy/client-core` prefill the chat composer and switch to the chat view for the user to review and send. The built-in document anonymizer gains a **Send to chat** button (opt-in per app via `DesktopAppDef.canSendToSession`, enriched with a context line + redaction count). A forward-looking `session.send` capability (permission + bridge method + client sugar) is added to `@moxxy/desktop-app-sdk` for sandboxed apps; it is renderer-dispatched, and the main-process bridge gate refuses it by design.
- Updated dependencies [e762d40]
- Updated dependencies [e762d40]
  - @moxxy/desktop-app-sdk@0.4.0
  - @moxxy/sdk@0.15.1
  - @moxxy/core@0.5.1
  - @moxxy/desktop-ipc-contract@0.10.1
  - @moxxy/plugin-stt-whisper-codex@0.0.24
  - @moxxy/plugin-vault@0.0.24
  - @moxxy/runner@0.2.14

## 0.8.1

### Patch Changes

- 668bd96: Desktop apps can send their output back to the active session instead of copy+paste. New shared `sendToSession()` + `composerDraftStore` in `@moxxy/client-core` prefill the chat composer and switch to the chat view for the user to review and send. The built-in document anonymizer gains a **Send to chat** button (opt-in per app via `DesktopAppDef.canSendToSession`, enriched with a context line + redaction count). A forward-looking `session.send` capability (permission + bridge method + client sugar) is added to `@moxxy/desktop-app-sdk` for sandboxed apps; it is renderer-dispatched, and the main-process bridge gate refuses it by design.
- Updated dependencies [668bd96]
  - @moxxy/desktop-app-sdk@0.3.0

## 0.8.0

### Minor Changes

- f070207: feat(collaborative): run archive/history + an always-available "End & archive"

  Two gaps the user hit: a wedged/finished collaboration couldn't be ended (the
  "＋ New" button only appeared once a run had completed, so a stuck run — or a
  stale single-flight lock — left the Collaborate tab with no way forward), and
  there was no record of past runs at all (the transient run dirs were even left
  orphaned).

  - **Run archive.** Every run is now persisted as a JSON record under
    `~/.moxxy/collab/runs/<runId>.json` on EVERY exit path (completed, aborted,
    failed) — task, brief, roster + per-agent status/summaries, board, contracts,
    merge result, and timings. New `@moxxy/mode-collaborative` archive API
    (`listRunRecords` / `readRunRecord` / `writeRunRecord`).
  - **End & archive.** New `collab.end` IPC aborts the coordinator turn (its
    finally tears the team down + archives) and force-releases the global lock —
    so a stuck run or a stale lock can always be cleared. New
    `forceReleaseCollabLock()` + `SessionDriver.abortActiveTurns()`.
  - **History view.** New `collab.history` IPC + a Collaborate-tab History list
    (outcome, task, agent counts, per-run detail with brief + summaries).
  - The Collaborate header now always offers **End & archive** (while running or
    while a lock is held) and the "already running" banner gained an inline
    "end & archive it now" so a wedged run never blocks a fresh start.

  Adds archive + force-release + abort tests, and the coordinator e2e test now
  asserts the run is archived.

### Patch Changes

- Updated dependencies [f070207]
  - @moxxy/desktop-ipc-contract@0.10.0

## 0.7.7

### Patch Changes

- Updated dependencies [4bdd6f8]
  - @moxxy/core@0.5.0
  - @moxxy/runner@0.2.13

## 0.7.6

### Patch Changes

- Updated dependencies [0870222]
  - @moxxy/core@0.4.0
  - @moxxy/runner@0.2.12

## 0.7.5

### Patch Changes

- Updated dependencies [6c48c28]
- Updated dependencies [6c48c28]
  - @moxxy/desktop-app-sdk@0.2.0
  - @moxxy/core@0.3.0
  - @moxxy/runner@0.2.11

## 0.7.4

### Patch Changes

- 7a43879: fix(desktop): robust PDF text extraction for the anonymizer + Office-doc previews in the Files pane

  - **Anonymizer "Could not extract text from this document" on real PDFs.**
    officeparser's stale bundled pdf.js silently returns an EMPTY string for many
    ordinary text-layer PDFs, surfacing as a generic extraction failure. PDF
    extraction now runs through `pdfjs-dist` (pure-JS, offline, in the main
    process — no native deps, no network): it concatenates every page's text
    layer AND pulls AcroForm field values (fillable personal-details forms keep
    their data in form fields, not the content stream). officeparser remains a
    fallback only when pdfjs cannot open the file. A genuinely image-only /
    scanned PDF (no text layer, no form fields) now gets a clear "looks like a
    scanned image — needs OCR" message instead of a blank failure.
  - **Files explorer preview for Office/ODF docs.** `.docx`/`.xlsx`/`.pptx`/
    `.odt`/`.ods`/`.odp`/`.rtf`/`.doc` opened in the Files pane now preview as
    their EXTRACTED text rather than the confirm-gated "binary file" prompt that
    would only ever show garbled zip bytes. (Images and PDFs already preview
    natively — `<img>` and Chromium's PDF viewer — via the existing image/pdf
    `workspace.readFile` branches.)

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/core@0.2.9
  - @moxxy/desktop-ipc-contract@0.9.4
  - @moxxy/plugin-stt-whisper-codex@0.0.23
  - @moxxy/plugin-vault@0.0.23
  - @moxxy/runner@0.2.10

## 0.7.3

### Patch Changes

- 82b8be9: feat(surfaces): interactive in-window browser + richer file preview

  **Browser — a genuinely interactive, full-bleed view.** The live view now behaves
  like a real browser: click / double-click, hover (`:hover` styles + tooltips via
  pointer move), scroll, full keyboard incl. modifier shortcuts, and
  back/forward/reload — with a snappier refresh that bursts a fresh frame after each
  interaction. The page viewport is resized to the pane (`surface.resize` →
  `setviewport`) so the view fills the whole container instead of being letterboxed,
  and clicks map 1:1. The install/loading states are on-brand (spinner, primary
  Button, indeterminate progress bar, condensed progress line) instead of dumping
  raw npm output.

  **Files — preview opens far more types.** Images and PDFs render inline (PDF via
  Chromium's viewer in a `blob:` iframe — `frame-src blob:` added to the CSP);
  text/code open directly; binary-looking or very large files prompt before opening
  as text (a huge blob in a `<pre>` can crash the renderer). `workspace.readFile`
  gained a discriminated result (`kind: text | image | pdf | confirm` plus
  `mediaType` / `base64` / `reason` / `byteLength`) and a `force` flag, and reads
  only a head window via a file handle so a multi-GB file never loads whole.

- Updated dependencies [82b8be9]
  - @moxxy/desktop-ipc-contract@0.9.3

## 0.7.2

### Patch Changes

- 72d89f3: fix(desktop): anonymizer NER runs fully offline + reads every common document type

  Two fixes to the offline document anonymizer:

  - **ORT wasm backend no longer hits a CDN.** The NER model failed with
    `no available backend found … Failed to fetch … cdn.jsdelivr.net/…/ort-wasm-simd-threaded.jsep.mjs`:
    transformers.js / onnxruntime-web resolved its WASM runtime glue from jsdelivr
    by default, which broke the offline guarantee and failed outright (CSP-blocked /
    offline). The onnxruntime-web artifacts (`ort-wasm-simd-threaded.jsep.{mjs,wasm}`)
    are now shipped as part of the app shell (copied from `@huggingface/transformers`
    into the renderer build at `/ort/`, served from the app's own origin in dev,
    loopback, and `file://`), and the worker pins `env.backends.onnx.wasm.wasmPaths`
    at that local base before the ORT session is created — nothing is fetched from a
    CDN. The renderer CSP already permits this (it all rides on `'self'`); no real
    network origin was opened.

  - **Reads all common document types.** The anonymizer now accepts PDF, Word
    (`.doc`/`.docx`), RTF, OpenDocument (`.odt`/`.ods`/`.odp`), spreadsheets,
    slides, and plain text. PDF/Office/ODF go through the existing officeparser
    pipeline; legacy binary `.doc` and `.rtf` (which officeparser doesn't handle)
    get dependency-free local extractors in a shared `parseBufferToText` core (so
    chat attachments benefit too). The "Open document" pane also accepts
    drag-and-drop: the renderer reads the dropped file's BYTES (which it already
    holds — no filesystem access) and sends them to a new host-only
    `anonymizer.parseDocumentBytes` IPC for extraction. It deliberately sends bytes
    rather than a path, so a compromised renderer can't forge a path to read an
    arbitrary file — the picker's provenance gate (which guards `parseDocument`)
    stays the only way main ever opens a renderer-named path. Everything stays
    local — no provider, runner, or network.

- 72d89f3: fix(desktop): stop the `moxxy-app://` scheme registration from crashing hot-updates (0.10 → 0.8 downgrade)

  The Apps feature registered its `moxxy-app://` privileged scheme with a
  top-level `protocol.registerSchemesAsPrivileged` call in the hot-updatable
  `index.ts`. Electron only honors that API **before** `app` is ready, but the
  immutable bootstrap loads the real main via `import()` **after** `whenReady` —
  so every hot-updated bundle threw `"protocol.registerSchemesAsPrivileged should
be called before app is ready"` on load, got poisoned, and reverted to the baked
  floor. Observed live as a 0.10.0 → 0.8.x downgrade.

  - Register the privileged scheme in the bootstrap's synchronous pre-ready
    prologue (the one place guaranteed to run before ready); the privileges are
    single-sourced in a new `app-scheme` module so the bootstrap and `index.ts`
    can't disagree. The call in `index.ts` is now a defensive no-op post-ready, so
    a new override no longer crashes even on an already-installed older bootstrap.
  - Pruning after staging now also keeps the last `confirmed` bundle — the exact
    rollback target `recoverFromFailedBoot` needs — so a genuinely failed boot
    rolls back to the last-good override instead of falling all the way to the
    floor.

- Updated dependencies [72d89f3]
  - @moxxy/desktop-ipc-contract@0.9.2

## 0.7.1

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/core@0.2.8
  - @moxxy/desktop-ipc-contract@0.9.1
  - @moxxy/plugin-stt-whisper-codex@0.0.22
  - @moxxy/plugin-vault@0.0.22
  - @moxxy/runner@0.2.9

## 0.7.0

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

### Patch Changes

- Updated dependencies [f8b0c63]
  - @moxxy/desktop-ipc-contract@0.9.0

## 0.6.0

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

### Patch Changes

- Updated dependencies [c058735]
  - @moxxy/desktop-ipc-contract@0.8.0

## 0.5.7

### Patch Changes

- Updated dependencies [897a1fc]
- Updated dependencies [897a1fc]
  - @moxxy/runner@0.2.8
  - @moxxy/plugin-vault@0.0.21
  - @moxxy/sdk@0.14.4
  - @moxxy/plugin-stt-whisper-codex@0.0.21
  - @moxxy/core@0.2.7
  - @moxxy/desktop-ipc-contract@0.7.6

## 0.5.6

### Patch Changes

- 0c86701: fix(surfaces): make the terminal a real PTY + offer to install the browser engine

  **Terminal — the root cause it never accepted input.** node-pty ships its macOS
  `spawn-helper` binary without the executable bit, and several install/repack
  paths (npm into the desktop's CLI prefix, pnpm's content store) keep it that way.
  node-pty then loads fine but `pty.spawn` throws `posix_spawnp failed`, which was
  silently swallowed into the piped fallback — a shell with no TTY line discipline,
  so a viewer's Enter (`\r`) never reaches it and nothing echoes. The pane looked
  alive (it showed a prompt) but ignored every keystroke. This affected dev and
  packaged builds alike, which is why earlier UI/sizing/ref-count fixes didn't
  help. Fix: `pty.ts` now repairs the `spawn-helper` exec bit before spawning and
  retries once; the installer chmods it after `npm install` too. When a real PTY
  genuinely can't start, the pane shows an honest "Terminal unavailable" status
  instead of a silently-dead box.

  **Browser — offer to install Playwright instead of erroring.** When the
  `playwright` npm package is missing, the browser surface now reports a distinct
  `needs-install` state and shows an **Install browser engine (~200MB)** button.
  On click it installs the npm package + the Chromium engine with live progress in
  the pane, restarts the sidecar, and resumes — no manual `npm i playwright` in the
  install dir.

## 0.5.5

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3
  - @moxxy/core@0.2.6
  - @moxxy/desktop-ipc-contract@0.7.5
  - @moxxy/plugin-stt-whisper-codex@0.0.20
  - @moxxy/plugin-vault@0.0.20
  - @moxxy/runner@0.2.7

## 0.5.4

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2
  - @moxxy/core@0.2.5
  - @moxxy/desktop-ipc-contract@0.7.4
  - @moxxy/plugin-stt-whisper-codex@0.0.19
  - @moxxy/plugin-vault@0.0.19
  - @moxxy/runner@0.2.6

## 0.5.3

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1
  - @moxxy/core@0.2.4
  - @moxxy/desktop-ipc-contract@0.7.3
  - @moxxy/plugin-stt-whisper-codex@0.0.18
  - @moxxy/plugin-vault@0.0.18
  - @moxxy/runner@0.2.5

## 0.5.2

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0
  - @moxxy/core@0.2.3
  - @moxxy/desktop-ipc-contract@0.7.2
  - @moxxy/plugin-stt-whisper-codex@0.0.17
  - @moxxy/plugin-vault@0.0.17
  - @moxxy/runner@0.2.4

## 0.5.1

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/core@0.2.2
  - @moxxy/desktop-ipc-contract@0.7.1
  - @moxxy/plugin-stt-whisper-codex@0.0.16
  - @moxxy/plugin-vault@0.0.16
  - @moxxy/runner@0.2.3

## 0.5.0

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
  - @moxxy/desktop-ipc-contract@0.7.0
  - @moxxy/core@0.2.1
  - @moxxy/plugin-stt-whisper-codex@0.0.15
  - @moxxy/plugin-vault@0.0.15
  - @moxxy/runner@0.2.2

## 0.4.1

### Patch Changes

- c15a45a: "Requires full update" releases now install themselves. New `app.updateShell` IPC drives electron-updater against a generic feed pinned at the exact `desktop-v<version>` release assets (GitHub latest/atom discovery can't parse `desktop-v*` tags), streaming download progress over `app.update.progress` and quit-and-installing on completion; the banner/Settings CTA becomes "Update app" with the release page kept as a fallback once an automatic attempt fails. macOS builds add a `zip` target so Squirrel.Mac can apply them, and desktop releases are no longer marked "Latest" on GitHub (`make_latest: false`).
- cc698ca: Two desktop fixes. (1) Fresh OAuth sign-up no longer strands the window on the Account Portal profile page: the portal-recovery net now also watches in-page (SPA) navigations — the portal's post-transfer router push to `/user` never fired `did-navigate` — and puts a 30s watchdog on the automatic `#/sso-callback` leg so a dead transfer page recovers into the app (where the boot sweep completes the sign-up) instead of requiring a restart. (2) Installing a full app update now actually runs it: the bootstrap's bundle gate gained a floor-version check (`older-than-floor` reject + active-pointer cleanup), so a hot-update override staged by a PREVIOUS install can no longer outrank the freshly installed shell — previously a stale 0.6 override kept booting over a newly installed 0.7.0, which then re-demanded the full installer forever.
- Updated dependencies [c15a45a]
  - @moxxy/desktop-ipc-contract@0.6.1

## 0.4.0

### Minor Changes

- aacdf1d: Desktop: live registry refresh + interactive provider management.

  The runner now broadcasts `info.changed` after every completed turn, so registry changes made by tools inside a conversation (provider_add, mcp_add, workflow_create, skill writes, …) reach attached clients; the desktop forwards the push to the renderer (`session.info.changed` → `SESSION_INFO_REFRESH_EVENT`) and the Settings panel re-fetches live — no more app restart to see an agent-added provider.

  Settings → Providers is now interactive: enable/disable any provider (runner protocol v7 `provider.setEnabled`, persisted to `preferences.json#disabledProviders` and honored by boot's activation walk; disabling the ACTIVE provider is refused), and a Configure sheet sets the API key (vault + live readiness re-probe via `provider.refreshReady`) and, for runtime-registered providers, the stored baseURL/default model (`provider.configure` through the new `SessionLike.providerAdmin` view). OAuth providers get a `moxxy login` hint instead of a key form.

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0
  - @moxxy/core@0.2.0
  - @moxxy/desktop-ipc-contract@0.6.0
  - @moxxy/plugin-stt-whisper-codex@0.0.14
  - @moxxy/plugin-vault@0.0.14
  - @moxxy/runner@0.2.1

## 0.3.0

### Minor Changes

- 0e1fb70: Sidebar redesign: every workspace is now a collapsible folder with its sessions nested beneath it (collapse state persists per workspace), a new-session [+] sits on each workspace row, and sessions are auto-titled from their first prompt (display-only, derived from the runner's meta sidecar at list time — also served to mobile via sessions.list) while staying renameable inline. client-core's useDesks gains desk-scoped session ops (createSession/setActiveSession/renameSession/removeSession) so the tree can operate across all workspaces at once.

## 0.2.1

### Patch Changes

- d3c1e26: Fix desktop sign-in never creating accounts for new users ("External account not found"). The account-portal recovery net no longer kills the portal's `/sign-in` + `/sign-up` pages — the OAuth sso-callback leg that converts a new-user sign-in into a sign-up runs there — and the renderer now sweeps up any dangling transferable OAuth attempt on boot and completes the sign-up + sign-in itself (`OAuthTransferBridge`), with a `clerk-captcha` mount node so bot-protection challenges can render outside the prebuilt components.

## 0.2.0

### Minor Changes

- d0e0bd2: Desktop workspaces now hold multiple sessions: desks persist a session list (v1 docs migrate so the first session keeps the desk's id and resumes its existing logs), the runner pool is keyed by session id (one `moxxy serve` per session), new `sessions.list/create/setActive/remove/rename` IPC commands (list/create/setActive/rename remote-allowed for mobile; remove host-only), and the sidebar shows the active desk's sessions with new/rename/delete affordances — `session.newSession` keeps its reset-current semantics. The desktop also gains dark mode (light/dark/system in Settings → Appearance, persisted in prefs, nativeTheme-synced, Clerk modals themed; designed `darkTokens` palette with CI-enforced light/dark parity), the workflow builder becomes a true infinite canvas (pan both axes unbounded, cursor-anchored zoom 10–400%, zoom-to-fit, persisted viewport), and self-update is honest about runner-protocol bumps: such releases report "requires full update" with a release-page link instead of staging a bundle the bootstrap would refuse and claiming success, update diagnostics explain boot-time refusals, and floor boots after a relaunch no longer inherit the previous override's identity.

### Patch Changes

- Updated dependencies [d0e0bd2]
  - @moxxy/desktop-ipc-contract@0.5.0

## 0.1.8

### Patch Changes

- 4c594d8: Wave of desktop/mobile fixes. Runner protocol v6 (additive): clients can supply the turn id (`runTurn.turnId`) so renderer per-turn filters actually match — fixing the silently-broken "generate skill with AI" flow and hidden-turn leaks — and `attach` gains a replay policy (`'full' | 'none' | { tail }`) with EventLog rebase so the desktop no longer replays full session history on app start/desk switch (history comes from the paginated NDJSON log). Desktop settings gain a shared "ask moxxy to do it" background-agent modal: the skill generator is refactored onto it and MCP servers and Providers get Add buttons driving `mcp_add_server`/`provider_add`, with permission asks surfaced in-modal (plus a global ask fallback outside the chat view). Subagents now inherit the parent's resolved model: hallucinated model ids warn and fall back, workflow-trigger spawns use the session's last resolved model, and hardcoded model-id fallbacks are gone. Clerk sign-in returns to the app instead of stranding on the hosted My-account page (explicit fallback redirect URLs + a main-process account-portal recovery handler). Workflow canvas: Delete/Backspace removes the selected node and dropping a connector on empty canvas opens an insert-node menu. Mobile: reconnects re-prime the connection store (fixes the deaf "Connected" state after a runner restart), gateway URL commits on blur, the redundant header actions toggle is gone, menu entries are chips, executed tools open a diagnostics panel on tap, and the QR scanner starts scanning immediately.
- Updated dependencies [4c594d8]
  - @moxxy/runner@0.2.0
  - @moxxy/core@0.1.0

## 0.1.7

### Patch Changes

- 35754ad: Fix packaged-app Google sign-in doing nothing (eternal button spinner): clerk-js's prebuilt sign-in buttons run the provider flow as a TOP-FRAME redirect, not a popup, and the navigation lockdown silently blocked it. `lockDownNavigation` gains an explicit `allowOriginPatterns` allow-list; the main window passes the OAuth hosts plus its own loopback serving origins so the frame can round-trip app → provider → Clerk FAPI → back, while everything else (and the focus window entirely) stays blanket-denied. Also adds `challenges.cloudflare.com` to CSP connect-src per Clerk's documented Turnstile requirements so the sign-up captcha can't dead-end.

## 0.1.6

### Patch Changes

- 218359b: fix(desktop): serve the packaged renderer from `https://desktop.moxxy.ai:<port>` so Clerk **production** keys work.

  A Clerk production key (`pk_live_`) is domain-locked: its Frontend API rejects any `Origin` that isn't `moxxy.ai` or a subdomain. The packaged renderer was served from a loopback IP origin (`http://127.0.0.1:<port>`), which a `pk_live_` key can never accept, so packaged sign-in with a production key silently failed.

  The loopback server now serves over **HTTPS** at `https://desktop.moxxy.ai:<port>` (a `moxxy.ai` subdomain that resolves to `127.0.0.1` via DNS, so traffic stays on-box). HTTPS uses a **self-signed cert** minted on first run and cached under `userData` (no key in the repo/bundle); the main process **scope-trusts** it via a session-level `setCertificateVerifyProc` (the reliable mechanism for loopback HTTPS under Electron's network service — `app.on('certificate-error')` does not fire here and is kept only as a fallback), trusting the cert only for that host + a matching fingerprint (not a blanket `ignore-certificate-errors`). The Host allow-list, CSP, and `allowedRedirectOrigins` now include the `desktop.moxxy.ai` origin; the DNS-rebinding guard stays intact for every other host. Dev (Vite + `pk_test_`) and the file:// fallback are unchanged.

  **Owner setup required** (one-time): add a DNS A-record `desktop.moxxy.ai → 127.0.0.1`, and register the four origins `https://desktop.moxxy.ai:{51789,51790,51791,51792}` in the production Clerk instance's allowed origins. See `docs/desktop-clerk-loopback-subdomain.md`.

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

- Updated dependencies [5ab8629]
- Updated dependencies [2796066]
  - @moxxy/runner@0.1.0
  - @moxxy/desktop-ipc-contract@0.4.0
  - @moxxy/sdk@0.10.0
  - @moxxy/core@0.0.13
  - @moxxy/plugin-stt-whisper-codex@0.0.13
  - @moxxy/plugin-vault@0.0.13

## 0.1.5

### Patch Changes

- 1e4ed09: chore(debt): unify tunnel spawning, finish MoxxyError adoption, retire stale casts

  Round-3 tech-debt drawdown:

  - **Tunnel unification (P2 #4).** New `spawnCliTunnel` + `isCliTunnelAvailable` exports on
    `@moxxy/sdk` own the spawn → parse-URL → resolve/reject lifecycle and no-orphan child
    cleanup for CLI tunnels. cloudflared/ngrok (channel-web) are now thin configs over it,
    and the webhooks plugin consumes registered `TunnelProviderDef`s instead of its own
    `startTunnel` (same URLs parsed, same teardown/pid/stop surface). channel-web's
    `child-cleanup.ts` is removed (folded into the SDK helper).
  - **MoxxyError adoption (P2 #5).** User-facing throws migrated to typed `MoxxyError`:
    oauth_authorize missing deviceUrl/authUrl (`TOOL_ERROR`), vault placeholder missing entry
    (`CONFIG_INVALID`), vault_get not-found (`TOOL_ERROR`), unsupported vault file
    (`VAULT_CORRUPT`). Internal invariant throws stay plain `Error`.
  - **Casts / hardcoded values (P3 #8).** Removed the `as unknown` exec-allowlist cast in
    plugin-security (CapabilitySpec.commands is now typed), tightened the Anthropic provider's
    `requestBody`/`countTokens` casts to the SDK's real param types (narrow, commented casts
    only where the SDK literal-narrows `media_type`), and corrected stale hardcoded model
    context windows (opus-4-7 / sonnet-4-6 are 1M, not 800k/200k) + maxOutputTokens.
  - **RemoteSession seam casts (P1 #1).** Dropped the redundant `as unknown as SessionLike`
    and command-handler casts in `desktop-host` (RemoteSession implements ClientSession →
    SessionLike; CommandContext.session is `unknown`).

- 00d7425: Desktop mobile gateway: deny-by-default remote command allow-list + gateway hardening.

  **Security fix (critical/high).** The runtime mobile gateway (Settings → Mobile, PR #141) wired the desktop's COMPLETE IPC handler set onto the WebSocket bus and bound the LAN wildcard. The only per-command filter for remote clients was a blocklist that omitted host-mutating commands — so a paired phone (or anyone on the LAN with the bearer token) could invoke `session.setAutoApprove` (disable the desktop's approval prompts, then run any tool unattended), `desks.create`/`rename`/`remove`, `onboarding.saveProviderKey`/`openExternal`, `app.updateCli`/`checkUpdate`/`updateDashboard`, vault/settings/prefs writes, and more — a privilege-escalation / RCE-adjacent hole.

  The model is now **allow-by-default-deny**. `@moxxy/desktop-ipc-contract` exports `REMOTE_ALLOWED_COMMANDS` — the single source of truth for the remote/mobile trust surface (the exact commands a paired chat client needs: session info/runTurn/abort/setMode/newSession/runCommand, transcribe, ask RESPOND, connection discovery/retry, the per-workspace transcript log, and `workflows.list`/`run`/`getRun`). `@moxxy/ipc-server-ws`'s `WebSocketCommandBus` rejects any command not on the list with a coded error, regardless of what handlers the host registered. The Electron (renderer) bus keeps full access — only the WS/remote bus is restricted. `REMOTE_DISALLOWED_COMMANDS` is kept (deprecated) for renderer affordance-gating but no longer drives enforcement.

  **Finding 2 (medium).** Workflow AUTHORING is host-only: `workflows.save`, `workflows.validateDraft`, and `workflows.setEnabled` are NOT on the remote allow-list — a paired phone cannot rewrite or re-enable the host's workflows. Read + run (`list`/`getRun`/`run`) stay allowed.

  **Finding 3 (medium, stability).** `MobileGatewayManager` start/stop/setEnabled/rotate/resume now serialize through a lifecycle lock, so a rapid off→on toggle (or a boot resume racing a user toggle) can't double-bind the port or leak a LAN-bound listener.

  **Finding 4 (medium).** Token rotation is now coherent with a pinned `MOXXY_WS_TOKEN`: rotation is a no-op-with-warning when the env token pins the credential (it can't be rotated from here without diverging the advertised connectUrl from the live accepted token), and `status()`/`connectUrl` always reflect the live accepted token.

  **Finding 5 (medium, security UX).** The Mobile tab warning now states plainly that the connection is unencrypted plain `ws://`, so anyone on the network can passively intercept the pairing token and all traffic without the QR — use only on trusted networks.

  The standalone `moxxy mobile` host (`@moxxy/plugin-channel-mobile`) is its own trust surface (it registers a curated single-session subset) and opts out of the contract allow-list via `new WebSocketCommandBus({ allowedCommands: null })`. The wave-5 hardening (Origin default-deny, bearer subprotocol auth, connection caps, slow-reader eviction) is unchanged and still applies on the runtime-gateway path.

- cdc2cc5: Desktop: new Settings → **Mobile** tab to enable a mobile gateway and pair a phone by scanning a QR — the mobile app then drives the desktop host exactly like the TUI does.

  - **Runtime bridge control.** The opt-in WebSocket bridge (`@moxxy/ipc-server-ws`) can now be started and stopped at runtime, not only at boot. A new `MobileGatewayManager` (`apps/desktop/electron/main/ws-bridge.ts`) owns the lifecycle: start (binds the LAN-advertised interface — `0.0.0.0` — so a phone on the same Wi-Fi can reach it), stop (closes the listener + terminates clients), status (running/host/port/token/connectUrl/clientCount), and token rotation (re-keys the live server, dropping every existing client). The on/off preference is persisted to the desktop prefs file (`DesktopPrefs.mobileGatewayEnabled`) so the gateway survives a restart. The env-gated boot path (`MOXXY_WS_BRIDGE=1`) still works for back-compat.
  - **New IPC commands** (`@moxxy/desktop-ipc-contract`, all Zod-validated): `mobileGateway.status`, `mobileGateway.setEnabled(enabled)`, `mobileGateway.rotateToken`, plus a `mobileGateway.changed` event for live status updates. These control the bridge, so they are **host-only** — added to `REMOTE_DISALLOWED_COMMANDS`, the WS bus refuses them so a remote client can never toggle the gateway or read/rotate the pairing token.
  - **The QR payload IS the connect URL** (`ws://host:port/?t=<token>`), built with the mobile-channel's pure pairing helpers (split into `@moxxy/plugin-channel-mobile/pairing` so the desktop main can import them without the tunnel-provider deps). A test imports the shipped app's own `parsePairingQrPayload` and asserts the desktop's `connectUrl` round-trips through it — proving the QR the desktop emits is exactly what the app accepts.
  - **Security:** the gateway is OFF by default and only starts on explicit user action; the LAN bind is the user's opt-in, surfaced with a prominent honest warning in the tab; bearer-token auth via the `Sec-WebSocket-Protocol` subprotocol and Origin default-deny stay in force; token rotation invalidates existing connections.

- 4a8ec5d: Workflows round-2 correctness: gate the unshippable `awaitInput` resume, make the visual builder work on the desktop, and fix loop/validation correctness.

  **`awaitInput` is gated (was a hang-forever dead-end).** The executor can pause + checkpoint an `awaitInput` step, but the resume trigger/channel that delivers the operator's reply never shipped to `main` — `resumeWorkflowRun` had zero production callers. So an agent-drafted "ask me, then act" workflow would pause forever, leak a retained child session for the process lifetime, and orphan a checkpoint file. `awaitInput` is now **rejected at validate/save time** with a clear "requires the resume channel, not available in this build" message, and `draft.ts` no longer teaches it (it steers the author to `inputs` fields instead). Defense-in-depth: the CLI runner treats a `paused` result as non-terminal (no inbox delivery), `Session.close()` clears retained child sessions so they can't leak, and a `WorkflowRunStore.sweepStale()` sweeper (7-day TTL, run on workflows boot) reaps orphaned `~/.moxxy/workflow-runs/active/` checkpoints. The executor pause/resume path is kept intact so re-enabling is a matter of landing a resume trigger and removing the schema gate.

  **Visual builder works on the desktop now.** The desktop drives a `RemoteSession`, whose workflows view only forwarded `list`/`setEnabled`/`run` — so the builder's `validateDraft`/`save`/`getRun` were `undefined` and threw "not supported on this session". Added a `workflow.validateDraft|save|getRun` runner-RPC family (**protocol bumped to v4**) with RemoteSession client methods + server handlers, so the desktop builder validates/saves/loads against the runner.

  **Loop + validation correctness.** A condition/switch step used as a loop body is rejected (its branch routing was silently ignored). A non-loop-body step that `needs` a loop-body step is rejected (it would stall — body steps are excluded from the main DAG). A loop-body step's own `when` guard and any `needs` other than its loop step / a sibling body step are rejected (body steps run unconditionally each iteration). Logic-step `vars` now drop `__proto__`/`constructor`/`prototype` keys (prototype-pollution guard). Paused-run checkpoints persist + restore `vars` set before the pause. Renaming a workflow via the builder removes the old file/entry instead of leaving an orphaned duplicate (`save(workflow, previousName)`, threaded through the view → IPC → runner RPC → builder hook).

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
  - @moxxy/plugin-vault@0.0.12
  - @moxxy/desktop-ipc-contract@0.3.0
  - @moxxy/runner@0.0.12
  - @moxxy/core@0.0.12
  - @moxxy/plugin-stt-whisper-codex@0.0.12

## 0.1.4

### Patch Changes

- cf2f651: Performance pack from the 2026-06-09 audit (A39–A42 + A42b): the TUI context meter caches its token estimate per log and folds in only new events instead of re-walking the entire event log (incl. JSON.stringify of every tool result) on every ~30Hz render; the desktop NDJSON chat log keeps a size/mtime-guarded line-offset index so scroll-up pages seek-read only their own byte range instead of re-reading and re-parsing the whole file per page; MemoryStore maintains its MEMORY.md index incrementally (no more O(N) re-read of every memory file per write) and gains a warn-only `maxMemories` soft cap (default 500 — no eviction, memories are user knowledge); goal mode declares its idle nudge as a volatile tail message and the stable-prefix cache strategy places its rolling tail breakpoint before volatile messages, so idle goal iterations re-read the cached prefix instead of paying a guaranteed-wasted cache write; and compactor-summarize now produces a real summary via the session's own provider/model (new optional `provider`/`model` on `CompactContext`), falls back to an honest, clearly-labeled head+tail digest when no provider is reachable, and reports `tokensSaved` from real character deltas instead of the fabricated `slice.length * 30`.
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/core@0.0.11
  - @moxxy/desktop-ipc-contract@0.2.2
  - @moxxy/plugin-stt-whisper-codex@0.0.11
  - @moxxy/plugin-vault@0.0.11
  - @moxxy/runner@0.0.11

## 0.1.3

### Patch Changes

- 05d643a: Audit wave 4 stability + packaging fixes:

  - `RunnerSupervisor.restart()` now uses the same graceful SIGTERM→SIGKILL
    termination (awaiting actual child exit) as every other teardown path,
    instead of a bare `child.kill()` + immediate respawn — closing the
    EADDRINUSE race where a quick restart collided with the dying `moxxy serve`
    still holding the runner socket.
  - `@moxxy/desktop-host` declares `@moxxy/core` as a real dependency (it
    imports `deleteSession` in prod source but had it under devDependencies) —
    the same missing-prod-dependency class of bug as the A1 packaged-desktop
    release blocker.
  - `@moxxy/mode-goal` declares `zod` as a real dependency (runtime import in
    `goal-tools.ts`, previously devDependencies-only).
  - (No version bump needed) `.github/workflows/release.yml`: the
    `desktop-v<version>` tag is now pushed only AFTER all installer builds
    succeed — builds check out a pinned sha, and `desktop-release` creates the
    tag + draft release together — so a failed desktop build no longer
    permanently burns the version.

- 2e4bc37: Self-update now verifies the bytes it executes (audit A2): the signed manifest
  carries a per-file sha256 map, checked against the extracted tree at stage time
  and re-checked by the bootstrap gate on every load (new `file-tampered` reject
  reason). Legacy manifests without the map keep loading but get no load-time
  verification; stripping the map from a new manifest breaks its signature.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [05d643a]
- Updated dependencies [0326fb0]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/core@0.0.10
  - @moxxy/sdk@0.8.0
  - @moxxy/plugin-vault@0.0.10
  - @moxxy/runner@0.0.10
  - @moxxy/desktop-ipc-contract@0.2.1
  - @moxxy/plugin-stt-whisper-codex@0.0.10

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
