---
"@moxxy/core": minor
"@moxxy/cli": patch
---

feat(runner): paged `session.loadHistory` + complete authoritative log

Add the runner-side foundation for retiring the desktop's dual chat history (the
renderer will later read transcript history from the runner instead of its own
NDJSON store).

- New runner protocol method `session.loadHistory` ({ before, limit } →
  { events, prevCursor }) — newest-first paging over the runner's authoritative
  event history. Bumps `RUNNER_PROTOCOL_VERSION` to 10; the change is purely
  additive, so `MIN_COMPATIBLE_PROTOCOL_VERSION` stays at 1 and an older client
  still attaches. `RemoteSession.loadHistory` gates the call on the server
  reporting v10+ and throws a clear, actionable "update the CLI" error against
  an older runner — which the desktop catches to fall back to its existing
  NDJSON path, so no transcript ever goes blank. The desktop FLOOR is
  intentionally NOT raised (the fallback keeps an older runner working); the
  release-build lockstep guard now allows the floor to lag an additive,
  version-gated runner bump.
- `@moxxy/core` gains a PAGED JSONL reader (`readSessionEventPage` + the pure
  `pageEvents` helper) that reads one `(before, limit)` page WITHOUT
  re-materializing the whole log, so `loadHistory` works even when the log isn't
  all in memory. Read-only — it preserves persistence's atomic-write + mutex
  invariants (it never mutates the file).
- Log completeness: when a turn streams assistant text but the provider never
  seals it with an `assistant_message` (e.g. an error/abort mid-stream — the
  case the renderer used to paper over by synthesizing a message that lived in
  no runner log), the runner now persists a REAL `assistant_message` on turn
  completion so its log is the complete authoritative history. Behavior-
  preserving for the normal sealed path.
