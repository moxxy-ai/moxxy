---
'@moxxy/cli': minor
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

The agent now waits on events instead of sleeping on a clock. `Bash` takes `background: true` to start a long command (a dev server, a watcher, a slow build) as a job and return its id at once; the new `Wait` tool wakes the instant that job finishes or prints output matching `until`, and `StopJob` ends it. Closing a conversation stops its jobs. A collaborative run's coordinator now resumes the moment an agent finishes or its process exits instead of on a 500 ms poll. `Sleep` accepts `ms: 0` next to `seconds` (models sent it and every such first sleep failed). The SDK exports `waitFor` / `wakeAfter` for event-driven waits with a deadline. `moxxy -p` now closes its session on Ctrl+C / SIGTERM before exiting, so neither background jobs nor a running foreground command are left behind as orphans.
