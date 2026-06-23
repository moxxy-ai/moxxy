---
"@moxxy/desktop-host": patch
---

Desktop: removing a workspace now actually sticks across a restart.

Deleting a desk tore down its runners and dropped it from the registry, but never
erased the underlying session logs in `~/.moxxy/sessions/`. On the next launch
`syncSessionIndexIntoRegistry()` re-imports every session whose sidecar still has
a first prompt and a live cwd, so the "deleted" workspace's conversations
resurrected (routed by cwd to another desk, or the Moxxy fallback) and piled up
orphan logs.

`desks.remove` now erases each removed session's on-disk log via `deleteSession`
after stopping its runner — the same ordering and best-effort guard the
single-session `sessions.remove` path already used — so a removed workspace stays
removed. (Single-session deletes were already correct.)
