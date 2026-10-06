---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Chat with a channel bot from the desktop: a new "Channels" section in the Runs sidebar opens Channels → <bot> as an ordinary chat attached live to the bot's own runner — write from the channel or from the app into one conversation (replies to app messages are also posted to the channel, falling back to the paired owner's DM). While the bot is down the chat shows its saved history and waits for it; the desktop never starts, stops or wipes a bot's runner (`/new` clears the conversation over the runner protocol). Setup, run mode and model moved behind the page's Setup button. Dedicated channel runners (Discord, Telegram, Slack, …) now resume one sticky session across restarts instead of starting a fresh one each time, and channel bot sessions no longer appear in the workspace tree, where opening one started a second writer on the bot's log.
