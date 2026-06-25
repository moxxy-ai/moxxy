---
"@moxxy/cli": minor
"@moxxy/sdk": minor
---

Slack bot channel on a dedicated, isolated runner.

- New built-in `@moxxy/plugin-channel-slack`: a Slack bot that ingests the Slack
  Events API over the self-hosted proxy relay, verifies each request's HMAC
  signature (Slack `v0` scheme + 5-minute replay window over the raw body), acks
  within Slack's 3-second window and then drives the agent in the background,
  dedupes Slack's at-least-once retries, and streams threaded replies via
  `chat.update`. Permissions use an autonomous allow-list
  (`channels.slack.allowedTools`; `['*']` = every tool, `[]` = read-only) — no
  human in the loop — so the bot can act independently. Configure with
  `moxxy slack setup` / `moxxy channels slack pair|status|unpair`; secrets live
  in the vault (`slack_bot_token`, `slack_signing_secret`).
- Channels can now run on their OWN dedicated runner — an isolated runner socket
  plus a sticky session, separate from the runner serving your desktop/TUI — so a
  channel acts as an independent agent thread that does work separately from
  yours. `slack` is dedicated by default; any channel can opt in with
  `--dedicated` (or `MOXXY_DEDICATED_RUNNER=1`). No runner-protocol change: one
  dedicated runner is still one Session.
- `SessionSource` gains `'slack'`, so a Slack runner's session is tagged
  distinctly and stays out of the desktop workspace sidebar.
