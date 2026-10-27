---
'@moxxy/plugin-provider-acp': patch
---

OpenCode 2's helpers show as helpers again. OpenCode 2 renamed its `task` tool to `subagent` and its `bash` tool to `shell`, so its helpers showed as a plain tool with OpenCode's instructions to the model as their result; now they show with their task, agent and answer, as OpenCode 1's do, and the helper's commands show as Bash. OpenCode 2's `acp` does not report what a helper started in the background does nor when it ends, and cannot stop it, so such a helper is closed at once with a note that it works on in the background; the live check records background work as not supported on OpenCode 2. OpenCode 1 is unchanged.
