---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Collaborative mode can start on Windows: its coordinator, hub and peer sockets are named pipes there instead of `.sock` paths, which Windows cannot listen on. The desktop no longer says "Reconnecting" while it is starting for the first time — it says it is starting the agent runtime and that this can take a few minutes after an install or update.
