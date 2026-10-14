---
"@moxxy/cli": minor
"@moxxy/sdk": minor
"@moxxy/desktop": patch
---

Large attachments no longer lock a chat in a reconnect loop. The runner keeps a client that is still taking a large frame (it drops only one that takes nothing for the grace window), sends clients large attachments by name and size only, and caps each history page; a client reads an attachment's bytes back in slices with the new `session.readAttachment` (runner protocol 26). Each model request carries at most 20 MB of attachments: the newest go in full, older ones become a note. The desktop re-attaches to a runner that is still alive instead of restarting it, stops with a clear error after repeated failures, and attaches any file: one the model cannot take whole goes as a note with its path on disk. A chat already stuck this way opens again after the update, with its history intact.
