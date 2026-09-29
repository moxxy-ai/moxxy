---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Discord voice calls start talking as soon as the agent has written its first sentence instead of after the whole reply, voicing the next sentences while one plays; talking over a reply drops the rest of it. The sentence splitter moved to `@moxxy/chat-model` so the desktop's Voice Mode and the bot share it.
