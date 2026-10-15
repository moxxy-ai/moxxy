---
'@moxxy/cli': patch
---

Moxxy's browser can open a page on this computer — an app the agent is building on `localhost:5173` — once the person allows that exact address and port through the usual site consent (`browser_allow_site`). Each port is allowed on its own, every other private address stays closed, and the same check runs in the tools, the browser process and its redirect guard. Opening a new tab now runs the same address check as navigating.
