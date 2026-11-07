---
'@moxxy/agent-connection-kit': patch
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

On Windows, Codex installed with npm whose `codex.exe` sits in a `node_modules` folder above the install no longer opens a console window. Before, every conversation with it kept a black window over the desktop. Moxxy now looks for `codex.exe` in every folder Codex's own `codex.js` looks in, and starts it directly.
