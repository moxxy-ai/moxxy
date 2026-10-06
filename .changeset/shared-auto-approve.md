---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

Auto-approve belongs to the conversation: switching it from Discord (`/auto-approve`) shows in the desktop's chat with the bot, and switching it in the desktop applies to the bot's own turns. The switch is recorded in the session log (runner protocol v21 adds `session.setAutoApprove`; `SessionInfo.autoApprove` reports it). A new conversation starts with it off.
