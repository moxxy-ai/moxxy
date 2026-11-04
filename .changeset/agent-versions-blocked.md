---
'@moxxy/cli': patch
'@moxxy/core': patch
'@moxxy/desktop': patch
'@moxxy/sdk': patch
---

Moxxy can now hold back a Claude Code, Codex or OpenCode version known to break with it. Such a version is simply not offered as an update, with nothing shown, since the installed version works; `moxxy agents update` refuses and says why. If that version is already installed, one card that can be closed says it may not work well with Moxxy and that a fixed version is on the way; the fixed version is then offered as a plain update. `moxxy agents` and `moxxy doctor` say the same. The list is read from the repository at most once an hour, so a new entry reaches every install without a release.

Checking several agents at once, as `moxxy agents` does, or from several runners at the same moment, no longer loses one agent's newest version in the shared cache, so the next update and its checks see the right version.
