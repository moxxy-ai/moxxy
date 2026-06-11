---
'@moxxy/desktop': minor
'@moxxy/desktop-host': minor
'@moxxy/client-core': minor
---

Sidebar redesign: every workspace is now a collapsible folder with its sessions nested beneath it (collapse state persists per workspace), a new-session [+] sits on each workspace row, and sessions are auto-titled from their first prompt (display-only, derived from the runner's meta sidecar at list time — also served to mobile via sessions.list) while staying renameable inline. client-core's useDesks gains desk-scoped session ops (createSession/setActiveSession/renameSession/removeSession) so the tree can operate across all workspaces at once.
