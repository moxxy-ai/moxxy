---
"@moxxy/sdk": patch
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Quality sweep, wave 7 (review long-tail triage — final cluster)

Triaged the audit's low-severity review long-tail: fixed the genuine
correctness/robustness items (each behavior-preserving + a regression test) and
consciously declined the subjective/stale nitpicks with a recorded rationale.

Representative fixes: OAuth `countTokens` now refreshes a near-expiry token
(was silently degrading to the estimate); desktop `ConnectionScreen` handles a
rejected (not just `{ok:false}`) update promise and names the real cause;
`BrowserPane` `preventDefault`s the keys it forwards; `useStepFlow` pins the
cursor to the shown step id so a late-applying step can't bounce the user; plus
assorted small robustness fixes across core/cli/plugins. Also replaced bare
`Function`-typed test casts with proper signatures (net lint improvement).

This is the last audit cluster — every finding in
`.claude/audits/quality-sweep-findings.json` is now either fixed or consciously
resolved with a rationale.
