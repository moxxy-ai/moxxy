# @moxxy/desktop-app-sdk

## 0.3.0

### Minor Changes

- 668bd96: Desktop apps can send their output back to the active session instead of copy+paste. New shared `sendToSession()` + `composerDraftStore` in `@moxxy/client-core` prefill the chat composer and switch to the chat view for the user to review and send. The built-in document anonymizer gains a **Send to chat** button (opt-in per app via `DesktopAppDef.canSendToSession`, enriched with a context line + redaction count). A forward-looking `session.send` capability (permission + bridge method + client sugar) is added to `@moxxy/desktop-app-sdk` for sandboxed apps; it is renderer-dispatched, and the main-process bridge gate refuses it by design.

## 0.2.0

### Minor Changes

- 6c48c28: feat(desktop): `@moxxy/desktop-app-sdk` — the contract for sandboxed desktop mini-apps

  The foundation of the custom-apps platform: a `moxxy-app.json` manifest schema
  (id, ui entry, install assets + per-app host allow-list, declared permissions),
  a closed capability list, the host↔app bridge protocol (typed postMessage RPC,
  one permission per method), and the browser-side `connectMoxxyApp()` client an
  app imports. Apps run as isolated web bundles in a cross-origin `moxxy-app://`
  iframe and reach host services only through declared permissions — so the
  manifest is the complete, auditable grant list. (Host discovery, the sandbox
  surface, the anonymizer migration, and the create-app skill build on this.)
