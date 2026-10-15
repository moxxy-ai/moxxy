---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

On Windows, closing a conversation ends the whole process tree of its Codex or OpenCode, so a Codex installed with npm (a Node launcher with the native agent as its child) no longer keeps running after the conversation closes.
