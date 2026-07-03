---
'@moxxy/cli': minor
'@moxxy/plugin-plugins-admin': minor
'@moxxy/config': minor
'@moxxy/plugin-stt-whisper': minor
'@moxxy/plugin-stt-whisper-codex': minor
'@moxxy/plugin-telegram': minor
'@moxxy/plugin-channel-slack': minor
'@moxxy/plugin-provider-admin': minor
'@moxxy/plugin-mcp': minor
'@moxxy/desktop': patch
---

Slim wave, final batches: the whisper STT pair, the Telegram + Slack
channels, provider-admin and mcp move out of the CLI binary — all seeded
into the desktop (voice, Settings panels and Apps→Channels keep working
offline) and installable on demand everywhere else. `moxxy telegram` /
`moxxy channels start slack` on a slim install print the exact install
command instead of "unknown command". `@moxxy/config` flips public as the
channels' dependency closure. The kernel is now the plan's target set: the
TUI, built-in tools, default mode, context floors, vault, plugins-admin,
commands, memory, the two OAuth providers, and the dormant daemons.
