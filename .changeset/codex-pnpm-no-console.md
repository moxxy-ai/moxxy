---
'@moxxy/agent-connection-kit': patch
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

On Windows, Codex installed with pnpm no longer opens a console window. Before, every conversation with it kept a black window over the desktop, and short ones flashed at start-up. Moxxy now starts Codex's own `codex.exe` from pnpm's store, as it already did for npm, instead of its `codex.js`, which opened that window.
