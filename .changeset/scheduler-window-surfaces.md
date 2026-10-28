---
'@moxxy/cli': minor
'@moxxy/desktop': minor
'@moxxy/desktop-ipc-contract': patch
---

Show and set a schedule's time window outside the chat. `moxxy schedule add` takes `--from` and `--until` next to `--cron`, refused by the same rules as the `schedule_create` tool. `moxxy schedule list` prints the window and its next fire now comes from the scheduler itself, so it no longer says "in a few minutes" for a window that opens at 23:00. The desktop Schedules list shows the window under the cron ("29.10, 23:00 → 30.10, 07:00", or "ended …" once it is over, which is why the schedule is off), and its "When" cell no longer cuts the next fire short. The "Runs in" session picker (schedules, workflows, webhooks) no longer grows past its column over the State toggle when session titles are long.
