---
'@moxxy/core': patch
'@moxxy/sdk': patch
---

Event-log and session-persistence hardening (audit wave 5):

- `EventLog.ingest` no longer leaks async listener rejections as unhandled rejections — they are swallowed under the same non-fatal policy as `append()`.
- Session event-log write failures are no longer silent: one structured warning per failure streak (path + error), a `SessionPersistence.degraded` flag, and a recovery log once writes succeed again.
- `restoreEvents` re-sequences restored events to contiguous seq 0..n-1 around corrupt JSONL lines (warning with skip/re-sequence counts) and atomically repairs the on-disk file, so a single corrupt middle line no longer truncates attached-client replay or causes seq collisions on new appends.
- `projectMessages` skips empty/whitespace-only assistant text blocks (keeping tool_use blocks), so tool-only turns — including historical wedged logs — no longer produce empty text blocks that providers reject.
