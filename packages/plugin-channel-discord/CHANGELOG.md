# @moxxy/plugin-channel-discord

## 0.27.0

### Minor Changes

- e791484: New Discord channel (`moxxy discord`): a discord.js gateway bot on a dedicated, isolated runner, built on @moxxy/channel-kit. DM code pairing (bot DMs a one-time code, pasted into the terminal wizard), a paired-principal + per-guild-channel allow-list (vault-persisted, managed via local /allow and /deny), edit-throttled streamed replies (≥1200ms, Discord's ~5 edits/5s limit) with 2000-char splitting, button-based permission/approval prompts, session commands published as Discord slash commands, and voice-message transcription. SDK gains the 'discord' SessionSource; the CLI gains the install-on-first-use hint and session-source stamping for it.

### Patch Changes

- 81e6b68: Voice replies for the Telegram and Discord channels. When enabled with `/voice`, the channel synthesizes the final assistant reply through the session's active Synthesizer and sends it as a voice/audio message alongside the text.

  `@moxxy/channel-kit` gains the transport-agnostic pieces: `synthesizeReply` (TTS via `session.synthesizers.tryGetActive()` with markdown→speech cleanup), `ensureOggOpus` (passthrough or ffmpeg transcode, plain-audio fallback when ffmpeg is absent), `deliverVoiceReply`, and a shared `/voice` toggle resolver. The text reply always goes out first and every failure mode is a typed result, so a missing synthesizer, TTS error, or transcode failure never breaks the text answer. Messenger-specific delivery (grammy `sendVoice`/`sendAudio`, discord.js audio attachment) stays in each plugin.

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
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [b2a5fba]
- Updated dependencies [be28d55]
  - @moxxy/core@0.27.0
  - @moxxy/plugin-vault@0.27.0
  - @moxxy/channel-kit@0.27.0
  - @moxxy/sdk@0.27.0
