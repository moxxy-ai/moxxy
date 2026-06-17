---
"@moxxy/sdk": minor
"@moxxy/cli": minor
"@moxxy/desktop": minor
---

Agentic surfaces: repurpose the desktop context rail into a dropdown of shared,
agent-drivable panes.

- New swappable **Surface** block in the SDK (`defineSurface`, `SurfaceRegistry`,
  `SurfaceHost`) + runner protocol **v8** (`surface.*` methods + `surface.data`
  stream) so a runner-owned interactive resource (a PTY, a browser page) streams
  to a thin client and takes its input back — no reverse RPC.
- **Terminal** (`@moxxy/plugin-terminal`): a shared shell the user and the agent
  drive together via a new `terminal` tool (node-pty when available, a piped
  shell otherwise); rendered live with xterm.js.
- **Browser**: a live, in-window view of the agent's Playwright page on
  `@moxxy/plugin-browser` — the user and agent share one page; clicks/keys/
  navigation are proxied to it.
- **Files changed**: a git-aware file list with the diff on the right; clicking a
  file opens a dropdown to Add it to the agent or Open it (diff/content). New
  `workspace.readFile` + `git.{isRepo,status,diff}` desktop IPC.
- The context button now opens a dropdown (Terminal / Files changed / Browser)
  instead of toggling; the rail is drag-resizable with a persisted width.
