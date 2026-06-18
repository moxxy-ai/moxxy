---
'@moxxy/cli': patch
---

fix(cli): drain persistence + close the session on one-shot command exit

One-shot commands (`moxxy -p`, `moxxy schedule run`, `doctor`, `login`, `init`)
booted a full session and returned without closing it, so the process relied on
the event loop draining — open webhook/scheduler/timer handles delayed (or hung)
exit, and the last appended event could still be in flight when the process
ended. Add a shared `closeSession(session, persistence?)` helper that drains the
index write (`flush`) + the append queue (`settleWrites`) so the LAST event is
durably on disk, then fires `onShutdown` hooks / stops the boot daemons via
`Session.close()`. Each command now calls it in a `finally` (preserving its exit
code), so the process exits promptly without dropping the final event.
