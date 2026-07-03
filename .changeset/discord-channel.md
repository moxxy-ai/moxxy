---
'@moxxy/plugin-channel-discord': minor
'@moxxy/sdk': minor
'@moxxy/cli': minor
---

New Discord channel (`moxxy discord`): a discord.js gateway bot on a dedicated, isolated runner, built on @moxxy/channel-kit. DM code pairing (bot DMs a one-time code, pasted into the terminal wizard), a paired-principal + per-guild-channel allow-list (vault-persisted, managed via local /allow and /deny), edit-throttled streamed replies (≥1200ms, Discord's ~5 edits/5s limit) with 2000-char splitting, button-based permission/approval prompts, session commands published as Discord slash commands, and voice-message transcription. SDK gains the 'discord' SessionSource; the CLI gains the install-on-first-use hint and session-source stamping for it.
