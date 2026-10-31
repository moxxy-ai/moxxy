---
'@moxxy/cli': patch
'@moxxy/desktop': patch
'@moxxy/sdk': patch
---

Agent updates no longer come back after Update, in the CLI and in the desktop. Moxxy now offers only a version the copy's own way of updating has, updates a Claude installed with winget through winget, and takes an old OpenCode through its plain upgrade before moving it to OpenCode 2. An update that asks a question or goes silent for ten minutes now stops with a clear message instead of spinning.
