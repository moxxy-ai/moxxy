---
'@moxxy/desktop': minor
'@moxxy/desktop-ipc-contract': minor
'@moxxy/desktop-host': minor
'@moxxy/client-core': minor
'@moxxy/plugin-scheduler': minor
'@moxxy/desktop-ui': patch
'@moxxy/sdk': patch
---

Create schedules from the desktop. Automations → Schedules has a New schedule button that opens a form: what Moxxy should do, how often (every few minutes or hours, every day, weekdays, every week, once, or a cron), optionally between two dates, a name filled in from the prompt and the chat it runs in. It says in one sentence what will happen, points at what is missing under each field, and never saves a schedule that could not run. The screen itself is redrawn as cards in the Settings look instead of a table: each schedule says its repeat in words ("Every 30 minutes"), then its window, next and last run; a schedule can be deleted (after a confirmation), and the list refreshes itself every 30 seconds.

Behind it: the new `scheduler.create` IPC command, checked in the host by `scheduleDraftProblem`, the scheduler's shared rules for a new schedule (`@moxxy/plugin-scheduler`); `useScheduler` gains `create` and an optional `refreshEveryMs`, and keeps one list for the whole window, so the Automations sidebar no longer misses a schedule created, paused or deleted on the screen; `Modal` takes a `className`.

Fixed: a running Moxxy no longer misses schedules created, paused or deleted by the desktop or `moxxy schedule`, and no longer writes its old copy back over them. Each process kept its first read of `schedules.json` for good; the store now reads the file again before every read and every change (`sharedWithOtherProcesses` in `createJsonFileStore`).
