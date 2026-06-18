---
"@moxxy/desktop": patch
---

feat(desktop): Files explorer in the context rail

Adds a **Files** option to the context-rail dropdown — a workspace file explorer
that browses the full directory tree and previews any file's contents (via
`workspace.readFile`). Unlike the existing **Files changed** option, it is always
available (no git repo required) so you can read/preview workspace files in any
project. Clicking a file opens the shared menu to Add it to the agent or Open it
in the viewer.

The click menu + list chrome shared by the two file panes are factored out into
`FilePaneShared.tsx` so "Files changed" and "Files" can't drift apart.
