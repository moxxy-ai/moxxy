---
'@moxxy/cli': patch
---

Switching a conversation to another agent or provider no longer sends the next message with the previous one's model. A turn that names no model used to reuse the model the conversation last ran on, whichever provider that was, so after switching from Claude to Codex the first message failed with "the 'claude-haiku-4-5' model is not supported". The remembered model now belongs to its provider: after a switch the new provider's default model is used, and the model picker shows it.
