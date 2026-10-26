---
'@moxxy/sdk': minor
'@moxxy/desktop-host': patch
'@moxxy/plugin-computer-control': patch
---

A tool can now narrow what "allow for this session" grants: `PermissionRule.sessionScope` names the input keys a session grant is tied to, so only the same request passes unasked later. The desktop honours it. `computer_request_access` uses it, because approving it grants access by itself: allowing one request for the session lets that same request through again, while another app, full control, the clipboard or system chords still ask.
