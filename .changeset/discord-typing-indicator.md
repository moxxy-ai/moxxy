---
'@moxxy/cli': patch
---

Discord shows "typing…" again while the bot works on a message: the indicator called discord.js's `sendTyping` detached from its channel, so every ping failed silently.
