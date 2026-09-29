---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

`/new` from another client of a conversation — such as the Discord bot — now clears the desktop's chat too, instead of leaving the old conversation on screen. `RemoteSession.onReset` tells a client when the runner started a new conversation.
