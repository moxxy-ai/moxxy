---
'@moxxy/desktop': patch
---

Stopping a runner whose start failed (a missing workspace folder, no `node`) no longer signals it. The process never started, and on Node 22 the signal could reach `kill(0, SIGTERM)`, the app's whole process group.
