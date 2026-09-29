---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

See a channel bot's conversation in the desktop: a new "Channels" section in the Runs sidebar opens Channels → <bot>, which shows the conversation read-only and updates as messages arrive (whether the bot runs from the app, as a background service, or not at all). Dedicated channel runners (Discord, Telegram, Slack, …) now resume one sticky session across restarts instead of starting a fresh one each time, and channel bot sessions no longer appear in the workspace tree, where opening one started a second writer on the bot's log.
