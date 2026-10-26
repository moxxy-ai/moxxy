---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Stop on a Codex agent conversation now also ends the commands the stopped turn started, which Codex otherwise leaves running; a command an earlier turn left running (a dev server) keeps running. The Codex connection knows the kinds Codex 0.163 sends, and the OpenCode agent offers only `opencode/big-pickle` before it is switched on, since `opencode/space-bunny-free` is no longer offered.
