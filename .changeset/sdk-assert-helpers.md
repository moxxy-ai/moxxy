---
'@moxxy/sdk': minor
---

New `invariant(condition, message)` and `assertDefined(value, message)` assertion helpers exported from `@moxxy/sdk` (alongside `assertNever`). Both narrow types via `asserts` signatures and fail loudly with the stated assumption — the sanctioned replacement for non-null assertions (`x!`) and deep optional chains (`a?.b?.c`), now codified as a guardrail in AGENTS.md.
