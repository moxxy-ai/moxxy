---
'@moxxy/cli': patch
'@moxxy/sdk': patch
'@moxxy/desktop': patch
---

The desktop shows Stop while another client of a conversation runs a turn — such as the Discord bot's agent working on a Discord request in Channels → Discord — and stopping it there stops the bot's turn. A runner now lists every running turn in `SessionInfo.runningTurns`, including turns a channel bot runs inside it, and `abort` reaches them (runner protocol v22). Browser tabs in the workbench stay open when you collapse the workbench or switch to another pane, until you close them.
