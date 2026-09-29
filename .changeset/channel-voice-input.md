---
'@moxxy/cli': patch
---

Voice notes sent to a channel bot (Discord, Telegram, …) are transcribed again: sessions now pick their speech-to-text backend at start — `plugins.transcriber.default`, else Codex transcription when you are logged in with ChatGPT — instead of leaving none active, so the bot no longer answers "no speech-to-text backend is configured" while the desktop mic works.
