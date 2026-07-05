# @moxxy/plugin-channel-slack

## 0.28.1

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1
  - @moxxy/channel-kit@0.28.1
  - @moxxy/config@0.28.1
  - @moxxy/core@0.28.1
  - @moxxy/plugin-tunnel-proxy@0.28.1
  - @moxxy/plugin-vault@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0
  - @moxxy/channel-kit@0.28.0
  - @moxxy/config@0.28.0
  - @moxxy/core@0.28.0
  - @moxxy/plugin-tunnel-proxy@0.28.0
  - @moxxy/plugin-vault@0.28.0

## 0.27.0

### Minor Changes

- 502acf0: Slim wave, final batches: the whisper STT pair, the Telegram + Slack
  channels, provider-admin and mcp move out of the CLI binary — all seeded
  into the desktop (voice, Settings panels and Apps→Channels keep working
  offline) and installable on demand everywhere else. `moxxy telegram` /
  `moxxy channels start slack` on a slim install print the exact install
  command instead of "unknown command". `@moxxy/config` flips public as the
  channels' dependency closure. The kernel is now the plan's target set: the
  TUI, built-in tools, default mode, context floors, vault, plugins-admin,
  commands, memory, the two OAuth providers, and the dormant daemons.

### Patch Changes

- 5d6677d: New `@moxxy/channel-kit` package: shared channel-building machinery extracted from the Telegram and Slack channels (throttled send-once-then-edit FramePump, turnId-filtered turn running + single-flight TurnCoordinator, host-code and TOFU pairing state machines, env→vault secret resolution, audited allow-list permissions, and the inbound-webhook ingest HTTP scaffold + delivery dedupe cache). plugin-telegram and plugin-channel-slack are refactored onto it with no behavior change, so upcoming channels (Discord, WhatsApp, Signal) can be thin adapters.
- 3b27404: `moxxy onboard` — one guided command from a fresh install to a paired, always-on agent: provider wizard (skipped when configured) → messenger pick from the install catalog → version-pinned install + `moxxy.setup` fields → the channel's own pairing in a new pair-then-return mode (`EXIT_AFTER_PAIR_FLAG` in the SDK, honored by all five pair flows) → a `moxxy serve --all` background unit. Also: channel install hints are now derived from catalog `provides` (telegram/slack/web/http entries gained theirs), Telegram + Slack declare `moxxy.setup` token steps, the `service` catalog's serve unit actually starts channels (`--all`, matching its description), and service units survive Electron-as-node installs (`ELECTRON_RUN_AS_NODE=1` exported into the unit).
- Updated dependencies [87aac6d]
- Updated dependencies [03e5f87]
- Updated dependencies [5d6677d]
- Updated dependencies [81e6b68]
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
- Updated dependencies [502acf0]
- Updated dependencies [be28d55]
  - @moxxy/config@0.27.0
  - @moxxy/core@0.27.0
  - @moxxy/plugin-vault@0.27.0
  - @moxxy/channel-kit@0.27.0
  - @moxxy/sdk@0.27.0
  - @moxxy/plugin-tunnel-proxy@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [ce56ef6]
  - @moxxy/sdk@0.26.0
  - @moxxy/core@0.26.0
  - @moxxy/config@0.26.0
  - @moxxy/plugin-tunnel-proxy@0.26.0
  - @moxxy/plugin-vault@0.26.0

## 0.0.5

### Patch Changes

- @moxxy/sdk@0.25.0
- @moxxy/core@0.25.0
- @moxxy/config@0.25.0
- @moxxy/plugin-tunnel-proxy@0.1.12
- @moxxy/plugin-vault@0.0.38

## 0.0.4

### Patch Changes

- @moxxy/sdk@0.24.1
- @moxxy/core@0.24.1
- @moxxy/config@0.24.1
- @moxxy/plugin-tunnel-proxy@0.1.11
- @moxxy/plugin-vault@0.0.37

## 0.0.3

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0
  - @moxxy/config@0.24.0
  - @moxxy/core@0.24.0
  - @moxxy/plugin-tunnel-proxy@0.1.10
  - @moxxy/plugin-vault@0.0.36

## 0.0.2

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0
  - @moxxy/config@0.23.0
  - @moxxy/core@0.23.0
  - @moxxy/plugin-tunnel-proxy@0.1.9
  - @moxxy/plugin-vault@0.0.35

## 0.0.1

### Patch Changes

- 48542df: Make "runs on a dedicated runner" a property a channel declares, and give
  Telegram the same dedicated-runner treatment as Slack.

  - `ChannelDef` gains optional `dedicatedRunner?: boolean` and
    `sessionSource?: SessionSource`. A channel now declares for itself that it
    should run on its own isolated runner (a distinct runner socket plus a sticky
    session, separate from the runner serving your desktop/TUI). The CLI reads
    this generically — there's no longer a hardcoded `name === 'slack'` check.
    `--dedicated` / `MOXXY_DEDICATED_RUNNER=1` remain runtime opt-ins, and a
    caller that already pinned the socket/session id/source (e.g. a supervisor)
    still wins.
  - `@moxxy/plugin-telegram` now declares `dedicatedRunner: true` +
    `sessionSource: 'telegram'`, so the Telegram bot runs on its own dedicated,
    isolated runner with persistent history (`moxxy-channel-telegram`), matching
    Slack. Telegram long-polls, so this needs no tunnel/webhook.
  - `@moxxy/plugin-channel-slack` now declares its dedicated-runner behavior
    explicitly (previously implicit in the CLI). No behavior change.
  - `SessionSource` gains `'telegram'`. `DeskSession.source` in
    `@moxxy/desktop-ipc-contract` now references the single `SessionSource` source
    of truth in `@moxxy/sdk` instead of a hand-copied union.

- 069cd0e: Run & control channels (Slack / Telegram) directly from the TUI and the CLI.

  - **`/channels` TUI panel**: a control panel inside the interactive TUI — list the
    configurable channels with live status (running · pid · uptime, plus the Slack
    Request URL once its tunnel opens), enter each channel's secrets into the vault,
    and Start / Stop it without leaving the chat. A channel started here runs
    **detached on its own dedicated runner**, so it keeps serving after you quit the
    TUI and is discovered/stopped from anywhere.
  - **`moxxy channels start|stop|status`**: headless lifecycle verbs for the same
    detached runners — `start <name>` validates the channel is configured (via its
    own availability gate) then spawns it, `status [name]` lists what's running
    (status-file read; instant, no session boot), `stop <name>` SIGTERMs it.
    `moxxy <channel>` (and `moxxy channels <name>`) still run in the foreground.
  - A channel now **self-describes its config** on its `ChannelDef`
    (`config: { fields: [{ label, vaultKey, secret, … }], hasRequestUrl, runHint }`),
    so any control surface renders the setup form + "configured" check from the
    registry instead of a hardcoded table. Slack and Telegram declare theirs.
  - New `@moxxy/sdk/server` runtime helpers power all of the above, keyed entirely
    off the per-channel status file (process-independent): `spawnDedicatedChannel`,
    `liveChannelStatus`, `listLiveChannelStatuses`, `stopDedicatedChannel`,
    `isPidAlive` — stale files (a crashed runner's dead pid) self-heal on read.
  - Fix: the Telegram channel now honors the `MOXXY_TELEGRAM_TOKEN` env override at
    start (precedence: explicit option → env → vault), matching its own
    `isAvailable` gate and error message + Slack's behavior. Previously a headless
    start with only the env var set passed the availability check but then failed to
    boot ("token not found").

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0
  - @moxxy/config@0.22.0
  - @moxxy/core@0.22.0
  - @moxxy/plugin-tunnel-proxy@0.1.8
  - @moxxy/plugin-vault@0.0.34
