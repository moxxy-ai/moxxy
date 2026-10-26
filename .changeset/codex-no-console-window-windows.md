---
"@moxxy/sdk": patch
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

On Windows, a conversation with Codex no longer opens an empty console window beside Moxxy. Behind an npm install's `codex.cmd`, Moxxy ran Codex's `codex.js` with Node, and that script starts Codex's own `codex.exe` without hiding its window, so Windows gave it a console of its own for as long as the conversation ran. Moxxy now starts that `codex.exe` itself, hidden, with the environment `codex.js` would give it (`CODEX_MANAGED_BY_NPM`, `CODEX_MANAGED_PACKAGE_ROOT`), and falls back to `codex.js` only when the program is not where npm puts it. An `ExecutableTarget` that runs a program directly can now carry environment for it.
