---
'@moxxy/desktop': patch
---

Updating the desktop app from its banner works again. The published update bundle left three packages (`zod`, `openai`, `electron-updater`) to the installed app's `node_modules`, which an update has none of, so every updated app failed to start ("Cannot find package 'zod'") and fell back to the installed version — and the banner then offered the same update again, forever. The app's main now carries those packages, building an update bundle fails if its main imports a package it does not carry, and a version that already failed to start on a machine is no longer offered there.
