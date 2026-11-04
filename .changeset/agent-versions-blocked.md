---
'@moxxy/cli': patch
'@moxxy/desktop': patch
'@moxxy/sdk': patch
---

Moxxy can now hold back a Claude Code, Codex or OpenCode version known to break with it. Such a version is not offered as an update: the card and Settings say why instead of showing Update, and `moxxy agents update` refuses with the same reason. If that version is already installed, Moxxy names the problem and says to wait for a fixed one; a newer, fixed version is offered as usual. `moxxy agents` and `moxxy doctor` show the same. The list is read from the repository at most once an hour, so a new entry reaches every install without a release.

Checking several agents at once, as `moxxy agents` does, or from several runners at the same moment, no longer loses one agent's newest version in the shared cache, so the next update and its checks see the right version.
