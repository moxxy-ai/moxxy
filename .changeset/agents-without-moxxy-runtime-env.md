---
'@moxxy/agent-connection-kit': patch
'@moxxy/plugin-provider-claude-code': patch
'@moxxy/plugin-provider-codex-agent': patch
'@moxxy/plugin-provider-acp': patch
---

Claude, Codex and OpenCode no longer inherit two settings meant only for Moxxy's own process. `ELECTRON_RUN_AS_NODE` made an Electron app the agent opened, such as VS Code, start as plain Node. The app's own module folders on `NODE_PATH` were searched by every `node` the agent ran. Folders you put on `NODE_PATH` yourself stay.
