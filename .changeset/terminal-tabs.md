---
'@moxxy/plugin-terminal': patch
'@moxxy/desktop-ipc-contract': patch
'@moxxy/desktop-host': patch
'@moxxy/desktop': patch
---

The Terminal pane has tabs. Agent is the terminal shared with the agent, as before; + opens a terminal of your own in the project's folder, shared by every chat of the project and kept across a new chat or a window reload. × (or a middle click) closes a tab and stops everything started from it, a detached dev server too, and quitting the app or removing the project closes them all. The shells are the main process's (`terminal.*` IPC commands); `createTerminalProcess` takes `env` for the shell and `nodePtyFrom`, where node-pty is loaded from, and a `TerminalProcess` tells its shell's `pid`.
