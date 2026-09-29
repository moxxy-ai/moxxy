---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Discord voice calls no longer go quiet for the rest of a turn after you (or noise on your microphone) talk over the bot: it skips only the rest of what it was saying, then still says the next step and the agent's result. A sentence the text-to-speech service could not voice is now logged with the reason instead of being skipped silently.
