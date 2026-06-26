---
"@moxxy/sdk": minor
"@moxxy/cli": minor
"@moxxy/plugin-cli": minor
"@moxxy/plugin-channel-slack": patch
"@moxxy/plugin-telegram": patch
---

Run & control channels (Slack / Telegram) directly from the TUI and the CLI.

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
