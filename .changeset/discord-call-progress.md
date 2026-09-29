---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Discord voice calls tell you what the agent is doing while it works: the agent says in a short sentence what it is about to check, the bot names a step the agent starts silently ("Przeglądam pliki.", "Sprawdzam, czy wszystko działa."), and says it is still working during a long step. The voice feedback scheduler and the step categories moved to `@moxxy/chat-model` so the desktop's Voice Mode and the bot share them.
