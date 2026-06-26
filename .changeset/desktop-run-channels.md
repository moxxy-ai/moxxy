---
"@moxxy/desktop-ipc-contract": minor
"@moxxy/desktop-host": minor
"@moxxy/client-core": minor
"@moxxy/sdk": minor
"@moxxy/desktop": patch
"@moxxy/cli": patch
---

Run Slack & Telegram channels from the desktop, each on its own dedicated runner.

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
