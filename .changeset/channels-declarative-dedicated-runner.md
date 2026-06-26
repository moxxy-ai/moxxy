---
"@moxxy/sdk": minor
"@moxxy/plugin-telegram": minor
"@moxxy/cli": patch
"@moxxy/plugin-channel-slack": patch
"@moxxy/desktop-ipc-contract": patch
---

Make "runs on a dedicated runner" a property a channel declares, and give
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
