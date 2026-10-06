---
'@moxxy/cli': patch
---

Discord: asked for a file ("send me the photo"), the bot attaches it with `discord_send_message` instead of replying with a `file://` link that cannot be opened in Discord — its turns now tell the model it is replying on Discord and how to send files there.
