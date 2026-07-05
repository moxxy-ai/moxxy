# @moxxy/channel-kit

## 0.28.1

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0

## 0.27.0

### Minor Changes

- 5d6677d: New `@moxxy/channel-kit` package: shared channel-building machinery extracted from the Telegram and Slack channels (throttled send-once-then-edit FramePump, turnId-filtered turn running + single-flight TurnCoordinator, host-code and TOFU pairing state machines, env→vault secret resolution, audited allow-list permissions, and the inbound-webhook ingest HTTP scaffold + delivery dedupe cache). plugin-telegram and plugin-channel-slack are refactored onto it with no behavior change, so upcoming channels (Discord, WhatsApp, Signal) can be thin adapters.
- 81e6b68: Voice replies for the Telegram and Discord channels. When enabled with `/voice`, the channel synthesizes the final assistant reply through the session's active Synthesizer and sends it as a voice/audio message alongside the text.

  `@moxxy/channel-kit` gains the transport-agnostic pieces: `synthesizeReply` (TTS via `session.synthesizers.tryGetActive()` with markdown→speech cleanup), `ensureOggOpus` (passthrough or ffmpeg transcode, plain-audio fallback when ffmpeg is absent), `deliverVoiceReply`, and a shared `/voice` toggle resolver. The text reply always goes out first and every failure mode is a typed result, so a missing synthesizer, TTS error, or transcode failure never breaks the text answer. Messenger-specific delivery (grammy `sendVoice`/`sendAudio`, discord.js audio attachment) stays in each plugin.

### Patch Changes

- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [be28d55]
  - @moxxy/sdk@0.27.0
