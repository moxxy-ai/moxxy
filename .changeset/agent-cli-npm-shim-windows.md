---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

On Windows, the version check and update of an agent CLI installed with npm (Claude Code, Codex, OpenCode) now run what the npm `.cmd` shim points at, instead of reporting the version as unknown and failing the update. The tests of `moxxy agents` and the desktop's install and update stand in for the CLIs with Node scripts, so they run on Windows too.
