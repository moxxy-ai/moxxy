---
'@moxxy/cli': patch
---

Guard `afterWorkflow` triggers against cycles. Mutual triggers (A↔B, or longer loops) used to re-fire each other forever, burning provider tokens. Each run now carries its trigger chain on the `workflow_completed` event: re-fires that would revisit a workflow already in the chain, or exceed a depth cap of 8, are refused with a clear warning. On top of that, trigger sync statically detects cycles in the `afterWorkflow` graph, warns once naming the cycle, and disables auto-refire for its members (they remain runnable manually or on schedule).
