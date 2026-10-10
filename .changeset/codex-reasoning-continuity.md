---
'@moxxy/cli': patch
'@moxxy/sdk': patch
---

Preserve completed, provider-owned reasoning items through the event log and replay them to ChatGPT OAuth on stateless tool continuations. Keep replay independent of visible reasoning summaries, retain multiple items without forwarding another provider's state, and ignore unfinished streamed state.
