---
'@moxxy/plugin-workflows': patch
'@moxxy/workflows-builder': patch
'@moxxy/plugin-scheduler': patch
'@moxxy/plugin-webhooks': patch
'@moxxy/plugin-usage-stats': patch
---

Replace non-null assertions and depth-2+ optional chains with guard clauses per the "Guard, don't chain" rule: `assertDefined`/`invariant` from `@moxxy/sdk` where absence is impossible by construction, narrow-once guards preserving silent paths where absence is a normal runtime path (optional loggers, optional layout, cache lookups). No behavior change on normal-absence paths.
