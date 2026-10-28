---
'@moxxy/plugin-scheduler': minor
'@moxxy/skills-builtin': patch
---

Let a recurring schedule run only inside a time window. `schedule_create` takes `startAt` and `endAt` next to `cron` ("every 30 minutes from 23:00 to 07:00"): nothing fires before `startAt`, the run at `endAt` still fires, nothing fires after it (not even a missed catch-up run), and the schedule turns itself off. A window that is already over is refused, and sending `cron` with `runAt` now tells the model to use `startAt`/`endAt` instead.
