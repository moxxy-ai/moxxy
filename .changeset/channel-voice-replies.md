---
'@moxxy/channel-kit': minor
'@moxxy/plugin-telegram': patch
'@moxxy/plugin-channel-discord': patch
---

Voice replies for the Telegram and Discord channels. When enabled with `/voice`, the channel synthesizes the final assistant reply through the session's active Synthesizer and sends it as a voice/audio message alongside the text.

`@moxxy/channel-kit` gains the transport-agnostic pieces: `synthesizeReply` (TTS via `session.synthesizers.tryGetActive()` with markdown→speech cleanup), `ensureOggOpus` (passthrough or ffmpeg transcode, plain-audio fallback when ffmpeg is absent), `deliverVoiceReply`, and a shared `/voice` toggle resolver. The text reply always goes out first and every failure mode is a typed result, so a missing synthesizer, TTS error, or transcode failure never breaks the text answer. Messenger-specific delivery (grammy `sendVoice`/`sendAudio`, discord.js audio attachment) stays in each plugin.
