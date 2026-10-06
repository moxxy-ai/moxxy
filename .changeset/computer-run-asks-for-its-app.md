---
'@moxxy/sdk': minor
'@moxxy/cli': minor
'@moxxy/desktop': patch
---

Approving a `computer_run` call on an app that is not granted yet now grants that app for the conversation at its default level, so a task no longer spends a model round on `computer_request_access`. Approvals record whether the call was decided now (`decidedNow`); a standing "always allow" rule grants no new app.
