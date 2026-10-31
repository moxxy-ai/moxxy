---
'@moxxy/cli': patch
'@moxxy/desktop': patch
'@moxxy/sdk': patch
---

Agent updates no longer come back after Update, in the CLI and in the desktop. Moxxy now offers only a version the copy's own way of updating has, updates a Claude installed with winget through winget, and takes an old OpenCode through its plain upgrade before moving it to OpenCode 2. An update that asks a question or goes silent for ten minutes now stops with a clear message instead of spinning.

Updates now go through whatever owns the copy, including bun, pnpm, yarn, Volta, Vite+ and npm with its own prefix. A copy Moxxy must not touch, such as one from mise, says what to do instead. Agent install and update notices are now cards in the toast corner with the agent's mark, the versions and progress in place, one card for each agent with an update.

Codex installed with pnpm, yarn or Volta on Windows is now found and offered its update. After every update Moxxy reads the version again: only a new version counts as done. A copy that stayed the same or stopped saying its version gets a calm note on the card, and one that no longer runs gets a failure with an install button. The desktop waits longer for a slow agent runner to start.

How an update ended stays on its card until you close it, also when the next check no longer offers that version, and Settings shows the same result. On Windows the Update button now works for pnpm, bun, yarn and Volta copies, without a terminal. A prompt Moxxy cannot answer is shown on the card with the command to run.
