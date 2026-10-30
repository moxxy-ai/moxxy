---
'@moxxy/desktop': patch
---

Move the desktop's dev-time `vite` to 6.4.5, the fix for GHSA-8g5g-mxqh-grgj (`server.fs.deny` could be bypassed with query strings on the dev server). Only the development server was affected; the packaged app does not ship Vite's server.
