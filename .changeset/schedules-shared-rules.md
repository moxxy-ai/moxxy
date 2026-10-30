---
'@moxxy/sdk': patch
'@moxxy/plugin-scheduler': minor
'@moxxy/cli': minor
'@moxxy/desktop': patch
'@moxxy/skills-builtin': patch
---

One set of rules for a new schedule, wherever it comes from. The `schedule_create` tool, `moxxy schedule add` and the desktop's New schedule form now check a draft with the same `scheduleDraftProblem` (split into `scheduleShapeProblem` and `scheduleTimingProblem`). A one-shot time more than a minute in the past is refused everywhere: the tool tells the model to ask the user for a new time, and the CLI exits with code 2 instead of only warning. A time set for the current minute still runs.

Two processes changing the schedules file at the same moment no longer lose each other's change: a store created with `sharedWithOtherProcesses` takes a short-lived `<file>.lock` around each change, and takes over a lock left behind for more than 10 seconds by a process that died.

The New schedule form starts with "Runs in" set to the chat you are in. It checks a custom cron as you type and shows an example when it is wrong. When the host refuses a save, the reason appears under the field it is about, in the form's own words; anything else shows as a sentence at the bottom of the form. The Schedules screen says "Next run: starting now" instead of "due now", and reads the list again a few seconds after the soonest run starts instead of waiting for the next 30-second refresh.
