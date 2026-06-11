---
'@moxxy/desktop': patch
---

Sidebar redesign: the WORKSPACES tree is replaced by a Slack-style workspace switcher — a roomy card showing the current workspace (name wraps instead of truncating, with a session count) that opens a dropdown to switch, remove, or create workspaces — and the active workspace's sessions become a flat, full-width list under a "Sessions" header with a [+] button. Row actions (rename/delete) move behind a hover-only ⋯ menu instead of always-visible icons. The Workflows view also gains a "Generate with AI" button — like Skills/MCP/Providers, it opens the ask-moxxy prompt box and the agent builds the workflow in the background via the `workflow_create`/`workflow_validate` tools, refreshing the list on completion. The switcher is text-only (no monogram tiles), and the sidebar can be collapsed/expanded (button in the rail, expand affordance in the main-pane header, Cmd/Ctrl+B, persisted across restarts).
