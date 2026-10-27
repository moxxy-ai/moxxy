---
'@moxxy/desktop': patch
'@moxxy/desktop-host': patch
'@moxxy/desktop-ipc-contract': patch
'@moxxy/workspace-registry': patch
---

First run is clearer about providers and never leaves the agent in a random folder. The provider picker now groups "Coding agents · SDK" (Claude Code, Codex, OpenCode) apart from "Model APIs" (Anthropic, OpenAI, …), and `settings.providerCatalog` returns `{ name, kind: 'agent' | 'api' }` entries instead of bare names. Skipping the workspace step now keeps a real workspace: the built-in Moxxy workspace is saved, brought to front and given the folder `~/Moxxy` (inside `MOXXY_HOME` when that is set), and the app starts its first runner there instead of in whatever folder the app process started in. The workspace step says where a skip keeps working. Workspaces that are already saved keep their folder.
