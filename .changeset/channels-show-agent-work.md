---
'@moxxy/cli': patch
---

Telegram and Discord now show an agent's work the way the desktop and the terminal do. An agent's list of steps is one list per turn (✓ done, ● in progress, ○ waiting, "Steps · 2 of 4 done") instead of a tool line for every `TaskCreate`, `TaskUpdate`, `TodoWrite` or `update_plan` call. While the agent of an agent connection uses your computer, the reply says so ("Codex is using your computer · Arc") and that `/cancel` stops it. Images a tool returned (screenshots) are named in the reply and sent after it, as photos on Telegram and attachments on Discord, the latest 10 per turn. Discord also shows file edits as diffs and the agents a turn spawned, as Telegram already did.
