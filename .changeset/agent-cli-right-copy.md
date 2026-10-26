---
'@moxxy/sdk': patch
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

The desktop finds the agent CLI the terminal runs even when the login shell does not answer: folders added only as a fallback (`/opt/homebrew/bin`, ...) come after the vendor installer's copy, so an old Homebrew `claude` no longer wins over a current `~/.local/bin/claude`. The version check, a conversation and Update now use the same copy, also one named by `CLAUDE_CODE_EXECUTABLE`, `CODEX_EXECUTABLE` or `OPENCODE_EXECUTABLE`. Of nvm's node versions the default one is searched first and the rest newest first (not by name), so an OpenCode under an old node no longer wins. A login shell that does not answer in time is stopped together with whatever its profile started. A failing shell makes way for the account's own shell and then launchd's PATH on macOS. Notices, `moxxy agents status` and `moxxy doctor` name the file checked and where it came from; a Homebrew copy updates with `brew upgrade`, and a copy inside an app (the Codex in ChatGPT.app) is left to that app.
