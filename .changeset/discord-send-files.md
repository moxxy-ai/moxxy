---
'@moxxy/cli': minor
---

`discord_send_message` can attach local files (`files`: up to 10, 10 MB in total — Discord's bot upload cap), so the bot can send you a file you ask for instead of a path. Oversized, missing or non-file paths are refused before anything is sent.
