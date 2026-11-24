---
'@moxxy/desktop': patch
'@moxxy/cli': patch
---

Closing a browser tab keeps the other pages open when tabs are opening at the same time. Closing the active tab selects a surviving page even after the desktop renderer reloads.
