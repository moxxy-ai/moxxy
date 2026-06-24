---
"@moxxy/client-core": patch
---

Fix: opening a workspace/session showed the empty "Ready when you are" state on
the first click and only loaded the conversation on a second click.

The first open of a workspace races the runner spawn: `chat.loadHistory` returns
`null` because no runner is attached yet, so `loadInitial` leaves the slot
unloaded for a retry. But the renderer attaches with `replay:'none'` (history is
pulled, never pushed), so nothing re-triggered the load once the runner reached
`connected` — the transcript stayed empty until the user re-opened the workspace.

`useChat` now re-runs the history load when the workspace's runner transitions to
`connected` (via the per-workspace connection store), so the transcript backfills
automatically. Idempotent — the load is guarded by `slot.loaded`, so a later
reconnect never re-pages.
