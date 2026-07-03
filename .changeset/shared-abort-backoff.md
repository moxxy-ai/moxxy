---
'@moxxy/sdk': patch
'@moxxy/cli': patch
---

refactor(sdk): surface the shared abort-backoff primitives (`sleepWithAbort`, `nextBackoffMs`) directly on the barrel (they were already exported, but buried in the mode-helpers block) and migrate the ad-hoc retry sleeps onto them: the runner's initial-connect retry + SIGTERM grace waits and the desktop supervisor's restart wait / socket poll / kill grace. All schedules and abort semantics preserved — no behavior change.
