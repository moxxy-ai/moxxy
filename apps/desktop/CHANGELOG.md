# @moxxy/desktop

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
