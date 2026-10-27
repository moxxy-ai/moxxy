# @moxxy/plugin-channel-discord

## 0.45.0

### Patch Changes

- 7cc93a2: "Always allow" on a request for access to an app now saves just that request: full access to Safari is let through later, also in a new conversation, but a request for Terminal or for more control still asks. Before, the answer was saved for the whole tool and every later request passed unasked. Within the conversation the answer covers the same request only, and Telegram and Discord now keep "Allow session" to the same request too for such a tool.

  For tool authors: the permission file takes `inputEquals` (exact values per input field), the SDK adds `alwaysAllowRule` and `createSessionGrants`, and runner protocol 32 carries `inputEquals` in `permission.addAllow` (a client never sends it to an older runner).

- Updated dependencies [71f8aa8]
- Updated dependencies [db33b95]
- Updated dependencies [71e90e5]
- Updated dependencies [84ff880]
- Updated dependencies [b6c11c4]
- Updated dependencies [02119e8]
- Updated dependencies [29841af]
- Updated dependencies [211f80c]
- Updated dependencies [49dd789]
- Updated dependencies [90ab0bb]
- Updated dependencies [cb494ef]
- Updated dependencies [b6c11c4]
- Updated dependencies [887b8b7]
- Updated dependencies [072b8b5]
- Updated dependencies [a8e8418]
- Updated dependencies [322f2ce]
- Updated dependencies [7868760]
- Updated dependencies [4af5560]
- Updated dependencies [ee669b7]
- Updated dependencies [3c1527c]
- Updated dependencies [178a215]
- Updated dependencies [318d476]
- Updated dependencies [7cc93a2]
- Updated dependencies [6e54a6b]
- Updated dependencies [1329245]
- Updated dependencies [8472068]
- Updated dependencies [deeeeea]
- Updated dependencies [46b20d3]
- Updated dependencies [9bfe644]
- Updated dependencies [d2de3a1]
- Updated dependencies [7d718f6]
- Updated dependencies [6f4d652]
- Updated dependencies [1fe7d4e]
- Updated dependencies [d118b03]
- Updated dependencies [2160501]
- Updated dependencies [2b9c87f]
- Updated dependencies [332e4c2]
- Updated dependencies [a06de31]
- Updated dependencies [066a949]
- Updated dependencies [fa44b8c]
  - @moxxy/sdk@0.45.0
  - @moxxy/core@0.45.0
  - @moxxy/chat-model@0.5.0
  - @moxxy/channel-kit@0.45.0
  - @moxxy/plugin-vault@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [d70839e]
  - @moxxy/sdk@0.44.0
  - @moxxy/channel-kit@0.44.0
  - @moxxy/chat-model@0.4.17
  - @moxxy/core@0.44.0
  - @moxxy/plugin-vault@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [7b24827]
- Updated dependencies [45f501a]
- Updated dependencies [1c4d5aa]
- Updated dependencies [889810e]
- Updated dependencies [3b0fcdf]
- Updated dependencies [0a44449]
- Updated dependencies [235ae19]
- Updated dependencies [a501dbd]
  - @moxxy/sdk@0.43.0
  - @moxxy/channel-kit@0.43.0
  - @moxxy/chat-model@0.4.16
  - @moxxy/core@0.43.0
  - @moxxy/plugin-vault@0.43.0

## 0.42.1

### Patch Changes

- @moxxy/sdk@0.42.1
- @moxxy/core@0.42.1
- @moxxy/channel-kit@0.42.1
- @moxxy/plugin-vault@0.42.1
- @moxxy/chat-model@0.4.15

## 0.42.0

### Minor Changes

- e1341f9: Give the Discord bot its own model. Pick it in Channels → Discord → Model in the desktop, or with `/model` in the chat (`/model <name>`, `/model default`). The choice is channel-scoped, so it never changes the model the app or TUI use, and it applies from the next message without restarting the bot. A saved model whose provider isn't connected falls back to the default with a notice.
- 788cfda: Add the `discord_send_message` tool so the agent can proactively DM the paired Discord owner about progress, finished work, or blockers from any session (desktop, goal mode, scheduled prompts) without the Discord channel running.

### Patch Changes

- Updated dependencies [1bde2f6]
- Updated dependencies [ac81f33]
- Updated dependencies [2f408fa]
- Updated dependencies [f44cf63]
- Updated dependencies [54d629a]
- Updated dependencies [ca9a67f]
- Updated dependencies [467542f]
- Updated dependencies [808bbfd]
- Updated dependencies [c329313]
- Updated dependencies [9cb28d6]
- Updated dependencies [bd8473c]
- Updated dependencies [40b40f4]
- Updated dependencies [194abc6]
- Updated dependencies [e825fa1]
- Updated dependencies [40d310e]
- Updated dependencies [5ca8fbe]
- Updated dependencies [c273722]
- Updated dependencies [5a18a15]
- Updated dependencies [97c44bd]
- Updated dependencies [8a10b7d]
- Updated dependencies [a34b1d7]
- Updated dependencies [1e5cb75]
- Updated dependencies [bf368a0]
- Updated dependencies [fe2eb5a]
- Updated dependencies [a34b1d7]
  - @moxxy/sdk@0.42.0
  - @moxxy/channel-kit@0.42.0
  - @moxxy/chat-model@0.4.14
  - @moxxy/core@0.42.0
  - @moxxy/plugin-vault@0.42.0

## 0.41.3

### Patch Changes

- Updated dependencies [6fefc59]
  - @moxxy/sdk@0.41.3
  - @moxxy/channel-kit@0.41.3
  - @moxxy/core@0.41.3
  - @moxxy/plugin-vault@0.41.3

## 0.41.2

### Patch Changes

- @moxxy/sdk@0.41.2
- @moxxy/core@0.41.2
- @moxxy/channel-kit@0.41.2
- @moxxy/plugin-vault@0.41.2

## 0.41.1

### Patch Changes

- @moxxy/sdk@0.41.1
- @moxxy/core@0.41.1
- @moxxy/channel-kit@0.41.1
- @moxxy/plugin-vault@0.41.1

## 0.41.0

### Patch Changes

- Updated dependencies [9039517]
- Updated dependencies [c6ee82d]
- Updated dependencies [b01809e]
- Updated dependencies [46136ab]
- Updated dependencies [f13cda7]
- Updated dependencies [ba473d9]
  - @moxxy/sdk@0.41.0
  - @moxxy/channel-kit@0.41.0
  - @moxxy/core@0.41.0
  - @moxxy/plugin-vault@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [7e47604]
  - @moxxy/sdk@0.40.0
  - @moxxy/channel-kit@0.40.0
  - @moxxy/core@0.40.0
  - @moxxy/plugin-vault@0.40.0

## 0.39.0

### Patch Changes

- Updated dependencies [1d983d9]
  - @moxxy/sdk@0.39.0
  - @moxxy/channel-kit@0.39.0
  - @moxxy/core@0.39.0
  - @moxxy/plugin-vault@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [971fd32]
  - @moxxy/sdk@0.38.0
  - @moxxy/channel-kit@0.38.0
  - @moxxy/core@0.38.0
  - @moxxy/plugin-vault@0.38.0

## 0.37.2

### Patch Changes

- Updated dependencies [84dd2c5]
  - @moxxy/sdk@0.37.2
  - @moxxy/channel-kit@0.37.2
  - @moxxy/core@0.37.2
  - @moxxy/plugin-vault@0.37.2

## 0.37.1

### Patch Changes

- Updated dependencies [e80b9d6]
- Updated dependencies [abd9482]
- Updated dependencies [5e4ca9f]
  - @moxxy/sdk@0.37.1
  - @moxxy/channel-kit@0.37.1
  - @moxxy/core@0.37.1
  - @moxxy/plugin-vault@0.37.1

## 0.37.0

### Patch Changes

- Updated dependencies [78938f8]
  - @moxxy/sdk@0.37.0
  - @moxxy/channel-kit@0.37.0
  - @moxxy/core@0.37.0
  - @moxxy/plugin-vault@0.37.0

## 0.36.1

### Patch Changes

- @moxxy/sdk@0.36.1
- @moxxy/core@0.36.1
- @moxxy/channel-kit@0.36.1
- @moxxy/plugin-vault@0.36.1

## 0.36.0

### Patch Changes

- Updated dependencies [bc7844e]
  - @moxxy/sdk@0.36.0
  - @moxxy/channel-kit@0.36.0
  - @moxxy/core@0.36.0
  - @moxxy/plugin-vault@0.36.0

## 0.35.4

### Patch Changes

- @moxxy/sdk@0.35.4
- @moxxy/core@0.35.4
- @moxxy/channel-kit@0.35.4
- @moxxy/plugin-vault@0.35.4

## 0.35.3

### Patch Changes

- @moxxy/sdk@0.35.3
- @moxxy/core@0.35.3
- @moxxy/channel-kit@0.35.3
- @moxxy/plugin-vault@0.35.3

## 0.35.2

### Patch Changes

- @moxxy/sdk@0.35.2
- @moxxy/core@0.35.2
- @moxxy/channel-kit@0.35.2
- @moxxy/plugin-vault@0.35.2

## 0.35.1

### Patch Changes

- @moxxy/sdk@0.35.1
- @moxxy/core@0.35.1
- @moxxy/channel-kit@0.35.1
- @moxxy/plugin-vault@0.35.1

## 0.35.0

### Patch Changes

- Updated dependencies [57f0810]
  - @moxxy/sdk@0.35.0
  - @moxxy/channel-kit@0.35.0
  - @moxxy/core@0.35.0
  - @moxxy/plugin-vault@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [ae16897]
- Updated dependencies [d9ae119]
- Updated dependencies [6d8fdcd]
- Updated dependencies [220673e]
- Updated dependencies [b25850c]
- Updated dependencies [63b1df5]
- Updated dependencies [3dfc2f3]
- Updated dependencies [e52e2ed]
- Updated dependencies [e52e2ed]
- Updated dependencies [06e81f8]
  - @moxxy/core@0.34.0
  - @moxxy/sdk@0.34.0
  - @moxxy/channel-kit@0.34.0
  - @moxxy/plugin-vault@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [b241085]
  - @moxxy/sdk@0.33.0
  - @moxxy/channel-kit@0.33.0
  - @moxxy/core@0.33.0
  - @moxxy/plugin-vault@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [3b0c14a]
  - @moxxy/sdk@0.32.0
  - @moxxy/channel-kit@0.32.0
  - @moxxy/core@0.32.0
  - @moxxy/plugin-vault@0.32.0

## 0.31.0

### Patch Changes

- Updated dependencies [8bb26b1]
- Updated dependencies [43926ab]
  - @moxxy/sdk@0.31.0
  - @moxxy/channel-kit@0.31.0
  - @moxxy/core@0.31.0
  - @moxxy/plugin-vault@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [c124a15]
  - @moxxy/sdk@0.30.0
  - @moxxy/channel-kit@0.30.0
  - @moxxy/core@0.30.0
  - @moxxy/plugin-vault@0.30.0

## 0.29.0

### Patch Changes

- 8ef529a: Replace non-null assertions (`x!`) and deep optional chains (`a?.b?.c`) in the
  channel plugins with guard clauses. Source sites that are impossible-by-construction
  now assert loudly via `assertDefined`/`invariant` from `@moxxy/sdk` instead of
  silently propagating `undefined`; inbound-message silent-drop gates are preserved
  exactly. No behavior change on the success path.
- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/sdk@0.29.0
  - @moxxy/channel-kit@0.29.0
  - @moxxy/core@0.29.0
  - @moxxy/plugin-vault@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1
  - @moxxy/channel-kit@0.28.1
  - @moxxy/core@0.28.1
  - @moxxy/plugin-vault@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0
  - @moxxy/channel-kit@0.28.0
  - @moxxy/core@0.28.0
  - @moxxy/plugin-vault@0.28.0

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
