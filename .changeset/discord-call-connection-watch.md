---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

A Discord voice call no longer goes deaf when its voice connection gets stuck reconnecting: the bot rejoins the channel after 15 s, and if that does not help it ends the call and tells you in DMs so you can `/call` again. Connection changes are logged.
