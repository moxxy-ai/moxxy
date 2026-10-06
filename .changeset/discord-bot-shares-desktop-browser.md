---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

The Discord bot's agent now drives the desktop's browser instead of an unseen one of its own (a bot started from the app inherits the browser bridge like every workspace runner), and Channels → Discord shows the same Terminal / Files / Diff / Browser workbench as a workspace chat, opening the browser when the bot's agent uses it. On Discord the agent knows you cannot see its browser or terminal: it asks in the chat when a page wants your choice (such as a cookie banner) instead of waiting for a click you cannot make.
