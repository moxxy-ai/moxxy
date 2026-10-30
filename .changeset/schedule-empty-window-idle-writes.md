---
'@moxxy/sdk': minor
'@moxxy/plugin-scheduler': patch
'@moxxy/cli': patch
'@moxxy/desktop': patch
'@moxxy/skills-builtin': patch
---

A time window no run falls inside is refused instead of saved. "Every 5 minutes from 03:47 to 03:49" would never run, because the next run is 03:50: the `schedule_create` tool, `moxxy schedule add` and the desktop's New schedule form now say so, and the form's sentence no longer promises runs. `firstFireBetween` in `@moxxy/sdk/cron` finds the first fire inside a window.

An idle scheduler no longer touches `schedules.json`. Every running Moxxy rewrote the file on each 30-second tick while syncing skill schedules, even with nothing to change. It now compares first, and takes the file lock and writes only when something changed.
