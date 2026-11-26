---
'@moxxy/desktop': patch
'@moxxy/cli': patch
---

An agent's row in Settings → Providers no longer shows the installer's raw output while it installs: it shows a progress bar with the percentage, or the time so far when the installer gives none, and a word that a slow connection can take a few minutes. A failed install is said in plain words in a note under the row, with the installer's own words behind Show details.
