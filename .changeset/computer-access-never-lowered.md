---
'@moxxy/plugin-computer-control': patch
---

Asking for an app again no longer takes back a level the person already approved. A browser granted full control stayed full only until the model called `computer_request_access` for it once more without `full_access`; that later grant came back read-only, typing into the page was then refused, and the model went round asking again. The grant now keeps the highest level approved in the conversation.
