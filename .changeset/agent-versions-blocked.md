---
'@moxxy/cli': patch
'@moxxy/core': patch
'@moxxy/desktop': patch
'@moxxy/sdk': patch
---

Moxxy can now hold back a Claude Code, Codex or OpenCode version known to break with it. Such a version is simply not offered as an update, with nothing shown, since the installed version works; `moxxy agents update` refuses and says why. If that version is already installed, one card that can be closed says it may not work well with Moxxy and that a fixed version is on the way; the fixed version is then offered as a plain update. `moxxy agents` and `moxxy doctor` say the same. The list is read from the repository at most once an hour, so a new entry reaches every install without a release.

Checking several agents at once, as `moxxy agents` does, or from several runners at the same moment, no longer loses one agent's newest version in the shared cache, so the next update and its checks see the right version.

On Windows, an agent installed with npm into its own folder is updated in that folder (`npm install -g --prefix <folder>`), no longer by the agent's own update, which put the new version into npm's default folder and left the copy in use as it was. An npm copy whose folder Moxxy cannot prove gets the npm command to run instead of an Update button.

On Windows a Codex or other agent installed with pnpm, yarn or Volta into folders of its own (`PNPM_HOME`, `yarn --global-folder`, `VOLTA_HOME`) is now updated in those folders: Moxxy reads what the shim runs instead of judging by the folder's name. Before, such a copy got the agent's own update, which for yarn and Volta reinstalled npm's global copy and left the one in use as it was. A Windows shim Moxxy cannot place now gets the command to run instead of an Update button.
