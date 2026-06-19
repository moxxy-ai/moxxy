---
'@moxxy/client-core': minor
'@moxxy/desktop-app-sdk': minor
'@moxxy/desktop': minor
'@moxxy/desktop-host': patch
---

Desktop apps can send their output back to the active session instead of copy+paste. New shared `sendToSession()` + `composerDraftStore` in `@moxxy/client-core` prefill the chat composer and switch to the chat view for the user to review and send. The built-in document anonymizer gains a **Send to chat** button (opt-in per app via `DesktopAppDef.canSendToSession`, enriched with a context line + redaction count). A forward-looking `session.send` capability (permission + bridge method + client sugar) is added to `@moxxy/desktop-app-sdk` for sandboxed apps; it is renderer-dispatched, and the main-process bridge gate refuses it by design.
