---
'@moxxy/cli': patch
'@moxxy/sdk': minor
---

Fix channel bots answering every message with "No active provider" right after pairing (Discord, Telegram, Slack, Signal, WhatsApp). The pair flow ran the bot on the setup probe session, which never activates a model; a successful pairing now stops that bot and starts the channel for real with the configured model (or hands back to `moxxy onboard` as before). Adds `finishPairing` to `@moxxy/sdk` for channel pair flows.
