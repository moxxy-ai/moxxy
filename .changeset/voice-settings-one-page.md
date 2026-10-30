---
'@moxxy/desktop': minor
'@moxxy/desktop-host': minor
'@moxxy/desktop-ipc-contract': minor
'@moxxy/client-core': minor
'@moxxy/client-platform-web': patch
'@moxxy/plugin-channel-discord': patch
'@moxxy/chat-model': patch
---

Settings → Voice is now one page: the Voice Mode engine, the dictation models (Parakeet, Whisper turbo, OpenAI) and the voices that read replies aloud, each with a line on what sets it apart. Parakeet and Whisper turbo download from their row only when someone asks for them. A saved `local-piper` choice moves to `local-supertonic` on its own, and the local-voice names in the IPC and client APIs no longer mention an engine.
