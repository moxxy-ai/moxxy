---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

On Windows the agent's shell commands work again: Bash runs in Git Bash, or in Windows PowerShell where Git is not installed, instead of failing with `spawn /bin/sh ENOENT`. Long commands can now run in the background there, and the agent continues the moment one finishes (Wait) instead of pausing for a fixed time. Stopping a background job ends every process it started, so a stopped dev server no longer keeps running.
