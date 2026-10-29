---
'@moxxy/plugin-scheduler': patch
'@moxxy/sdk': patch
---

A time window that opens inside a minute (`startAt` at 23:00:30) no longer fires at 23:00:00, before the window: its first run is the next whole minute (23:01).

Two processes taking over a schedules lock left behind by a dead process can no longer both change `schedules.json` at once and lose one change. Only the waiter holding `<file>.lock.takeover` may remove the stale lock, and only if it is still stale then. The lock code moved into its own module, `packages/sdk/src/file-lock.ts`.
