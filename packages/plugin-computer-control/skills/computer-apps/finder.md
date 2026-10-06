---
name: computer-app-finder
description: How to work with Finder and file dialogs through Computer Use.
triggers:
  - "in finder"
  - "finder window"
apps:
  - com.apple.finder
  - Finder
---

Prefer the file tools (Read, Write, Glob, Bash) for reading, creating, moving or
renaming files: they are exact and need no window. Use Finder only when the task
is about what the user sees (selecting a file for them, a dialog, Quick Look).

- Go to a folder with `super+shift+g`, type the path, press `Return`; do not
  click through the sidebar.
- Rows in list and column views are elements: select by `element_index`, then
  `Return` renames and `super+o` opens.
- Moving to the Trash (`super+BackSpace`) and emptying it are destructive: do
  them only when the user asked for exactly that.
- Save and open dialogs refuse protected places (shell start-up files, `~/.ssh`,
  LaunchAgents, git hooks). Report the refusal; do not look for a way around it.
