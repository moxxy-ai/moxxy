# @moxxy/plugin-channel-slack

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
