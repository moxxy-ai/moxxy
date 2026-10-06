---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

A message you write in the desktop's chat with the Discord bot now shows in Discord too ("typed in moxxy: …") above its reply, and during a voice call the bot says that reply aloud. Channels share this through `TurnCoordinator.mirrorPrompt`, which skips machine prompts (schedules, webhooks, voice transcripts).
