---
'@moxxy/cli': patch
'@moxxy/sdk': patch
'@moxxy/desktop': patch
---

A conversation no longer gets stuck on `No tool call found for function call output` after a long-running tool finishes late. When a tool call was answered only after later turns had begun, the `segments` compactor could summarize the call while leaving its result behind, and every following request was rejected by the provider. The compactor now stops its window before such a call, and the projection drops a result whose call was summarized away (and answers a visible call whose result was), so sessions already in that state recover on their next message.
