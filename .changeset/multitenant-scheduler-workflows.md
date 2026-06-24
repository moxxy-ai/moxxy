---
"@moxxy/sdk": minor
"@moxxy/cli": minor
---

Make scheduled prompts and workflow triggers multi-tenant across concurrent runner processes.

The desktop runs one `moxxy serve` per workspace, and every runner ran its own scheduler poller / workflow-trigger wiring over the SAME shared stores. A due schedule (and any workflow it fires) therefore ran once **per runner** — N times for N open workspaces — and skill/workflow-mirrored schedules had no notion of which runner should own them.

Now:

- Schedules carry an optional `ownerSessionId`. `schedule_create` stamps it with the creating runner's `MOXXY_SESSION_ID`, so a schedule created in a workspace's chat fires only on **that** runner (its result lands where it was asked for), not whichever poller happens to tick first.
- Owner-less schedules (skill- and workflow-mirrored rows, or a single-process CLI with no session id) fire **exactly once across all runners** via a new cross-process "fire exactly once" lock (`CrossProcessFireLock`, exported from `@moxxy/sdk/server`) keyed on the entry's exact fire instant.
- Workflow `fileChanged` triggers are likewise guarded by the cross-process lock in the multi-runner case, so one edit runs the workflow once instead of once per watching runner.

Single-process CLI/TUI behavior is unchanged (no `MOXXY_SESSION_ID` → owner-less, fires as before).
