---
'@moxxy/agent-connection-kit': patch
'@moxxy/plugin-provider-claude-code': patch
'@moxxy/plugin-provider-codex-agent': patch
'@moxxy/plugin-provider-acp': patch
---

Claude and Codex no longer inherit Moxxy's own `MOXXY_*` variables. OpenCode already worked this way. The browser bridge token was readable by every command the agent ran. A `moxxy` command run by the agent joined the conversation's own runner instead of starting its own. `MOXXY_HOME` stays, so an isolated Moxxy keeps its own folder.
