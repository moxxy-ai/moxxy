---
'@moxxy/cli': patch
'@moxxy/desktop': patch
'@moxxy/sdk': minor
---

The agent no longer reports on work that has not finished. A browser read lists what the page itself marks as still working (`aria-busy`, a progress bar with no amount) and an action says when the page was still changing as it returned; any tool result can say so through the new `Progress` contract in `@moxxy/sdk`. The default mode then asks the agent once, at the end of its turn, to wait and look again before it reports. Turn-end checkpoints can declare `applies` to be skipped without a trace on turns they do not concern.
