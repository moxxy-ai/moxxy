---
"@moxxy/sdk": minor
"@moxxy/tools-builtin": patch
"@moxxy/chat-model": patch
"@moxxy/client-core": patch
"@moxxy/plugin-cli": patch
"@moxxy/plugin-channel-web": patch
"@moxxy/plugin-telegram": patch
"@moxxy/desktop": patch
---

Add a cross-channel file-diff preview for the Write/Edit tools. Every surface
now shows what changed when the agent writes a file — a classic diff of the
changed slices (±2 context lines) with line numbers, `+`/`-` markers, and
green/red line backgrounds, plus a "Added N lines, removed M lines" summary.

- The tools return a structured, channel-agnostic payload (`ToolDisplayResult`
  = `{ forModel, display }`); the model still sees only a short summary line, so
  the diff never bloats the context window.
- TUI: an inline highlight preview; `Ctrl+O` expands the changed files.
- Desktop: a diff card; click to expand the full set of hunks.
- Web / Telegram / mobile each render the same payload natively.

New public SDK surface (`@moxxy/sdk` and the dependency-free `@moxxy/sdk/tool-display`
subpath for browser/React-Native consumers): `FileDiffDisplay`, `DiffHunk`,
`DiffLine`, `DiffRow`, `ToolDisplay`, `ToolDisplayResult`, and the helpers
`isToolDisplayResult`, `isFileDiffDisplay`, `fileDiffSummary`, `fileDiffVerb`,
`diffGutterNo`, `toDiffRows`.
