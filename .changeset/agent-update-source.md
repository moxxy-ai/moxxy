---
'@moxxy/cli': patch
'@moxxy/desktop': patch
'@moxxy/sdk': patch
---

Agent updates no longer come back after Update, in the CLI and in the desktop. Moxxy now offers only a version the copy's own way of updating has, updates a Claude installed with winget through winget, and takes an old OpenCode through its plain upgrade before moving it to OpenCode 2. An update that asks a question or goes silent for ten minutes now stops with a clear message instead of spinning.

Updates now go through whatever owns the copy, including bun, pnpm, yarn, Volta, Vite+ and npm with its own prefix. A copy Moxxy must not touch, such as one from mise, says what to do instead. Agent install and update notices are now cards in the toast corner with the agent's mark, the versions and progress in place, one card for each agent with an update.

Codex installed with pnpm, yarn or Volta on Windows is now found and offered its update. An update that exits cleanly but removes the copy or leaves the version unchanged now reports a failure instead of "ready". The desktop waits longer for a slow agent runner to start.
