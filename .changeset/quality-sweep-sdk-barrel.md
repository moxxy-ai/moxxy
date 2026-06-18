---
"@moxxy/sdk": patch
"@moxxy/cli": patch
---

Quality sweep — additive `@moxxy/sdk` surface + context-fold dedup

Three purely-additive SDK changes (no removals, zero new internal deps):

- `MOXXY_PCM16_24KHZ_MIME` (u35-2): hoisted the cross-package PCM16/24 kHz wire
  MIME tag — previously redeclared as a bare literal in client-platform-web,
  plugin-stt-whisper, and plugin-cli — onto the SDK's typed transcriber surface
  as the single source of truth, with a lock test pinning the exact bytes.

- `runManualCompaction` (u80-2): a thin, log-first manual-compaction helper
  (compactor + log + provider/model + window → `{ compacted, tokensSaved,
  eventsCompacted }`) so `/compact` can share the SDK's compaction flow instead
  of hand-rolling it. `runCompactionIfNeeded`'s signature/behavior is unchanged.

- `computeElisionState` memo + threaded elision state (complexity-hotspots-7 /
  u122-2): the pure fold is now memoized on the input snapshot's identity, and
  `runElisionIfNeeded`/`runCompactionIfNeeded` derive one `ElisionState` per
  iteration and thread it into `estimateContextTokens` (and, opt-in, into
  `projectMessages`) — collapsing the ~3x-per-iteration re-fold to one.
  Byte-identical: the golden elision/projection tests still pass, plus a new
  memo-correctness test (same snapshot → cached state; any new array →
  recompute, never stale).
