# @moxxy/desktop

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
