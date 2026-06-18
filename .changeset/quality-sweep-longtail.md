---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Quality sweep, wave 5 (safe longtail — coverage + mechanical consistency/perf)

The additive/mechanical slice of the audit's low-severity long-tail; subjective
nitpicks and anything behavior-risky were deferred (tracked in `TECH_DEBT.md`).
Behavior-preserving except the small fixes noted, each covered by a test.

- **Coverage:** focused unit tests for previously-untested pure logic —
  command-palette parsers, chat suggestions, prompt reducer + escape-sequence
  matcher, slash-command matcher, config appliers, provider-admin `configure`,
  url-safety scheme table, vault placeholder resolution, and more.
- **Mechanical consistency/perf:** resolve vault object properties concurrently
  (key-order preserved), hoist per-row `stdout.columns`/`descWidth` reads out of
  the TUI tool list, drop a no-op identity `useMemo`, and a few small bounded
  fixes. A desktop latest-block cache-key bug (64-char-prefix collision) was
  fixed while adding its test.
