---
"@moxxy/sdk": minor
"@moxxy/cli": patch
---

refactor(channel): close the runner/thin-client dispatch typing seam

Add a single, audited `startChannelWith(channel, { session, ...overrides })`
helper to `@moxxy/sdk` that owns the one structural erasure at the
channel-dispatch boundary (`ChannelDef`/`Channel` are intentionally non-generic
over their start-options type, so `start` takes `unknown`). The helper's
signature now type-checks that every caller passes a real `ClientSession`, so a
bare `RemoteSession` (the thin-client proxy) is proven assignable end-to-end
even though the final hand-off to `start()` stays erased.

Retarget the four CLI dispatch sites (`serve`, `web-surface`, and both the
RemoteSession and in-process-Session paths in `start-registered-channel`) to
call it, removing their inline `as never` casts, and add a compile-time
conformance lock so a future regression that narrows `RemoteSession` or the
concrete `Session` below `ClientSession`/`SessionLike` becomes a type error.
No wire-shape or runner-protocol change.
