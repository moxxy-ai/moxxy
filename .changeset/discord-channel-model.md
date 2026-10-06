---
'@moxxy/cli': minor
'@moxxy/desktop': minor
'@moxxy/plugin-channel-discord': minor
---

Give the Discord bot its own model. Pick it in Channels → Discord → Model in the desktop, or with `/model` in the chat (`/model <name>`, `/model default`). The choice is channel-scoped, so it never changes the model the app or TUI use, and it applies from the next message without restarting the bot. A saved model whose provider isn't connected falls back to the default with a notice.
