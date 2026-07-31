---
'@moxxy/desktop': patch
---

Make workspace groups readable against the sessions inside them in the desktop sidebar. The group header was painted `--color-text-dim` while its session rows used `--color-sidebar-text-dim` — byte-identical colours in both themes — so a group and its children rendered the same, and a 4px indent was the only nesting cue. Headers now take the muted tier, carry the workspace's own colour as a square chip (`Desk.color`, already in the contract but never rendered), and their sessions hang off a guide rail with real spacing between groups.
