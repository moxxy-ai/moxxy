---
"@moxxy/client-core": patch
"@moxxy/desktop": patch
---

A finished turn's work folds into one line over the answer in the desktop conversation: "Worked for 4m 12s · 12 steps", opening to every step as it was drawn. The agent's comments along the way, its thoughts, tool runs and diffs no longer stretch the conversation; the person's messages, errors, "Stopped", notes, answered questions, the list of steps, a mode's card and the turn's last message stay in view, and the turn still going stays open. The grouping is `groupWorkNodes` in `@moxxy/client-core` (with the `WorkNode` row and `keyOfNode`), so other surfaces can draw the same.
