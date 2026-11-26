---
'@moxxy/desktop': patch
'@moxxy/cli': patch
---

An agent's row in Settings → Providers no longer shows the installer's raw output while it installs: it shows a progress bar with the percentage, or the time so far when the installer gives none, and a word that a slow connection can take a few minutes. After a failed install, Show details gives one diagnostic, such as the name of a missing command. The local log keeps the full output, including for long installs.
