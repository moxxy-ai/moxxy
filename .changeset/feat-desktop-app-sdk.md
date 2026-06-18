---
"@moxxy/desktop-app-sdk": minor
---

feat(desktop): `@moxxy/desktop-app-sdk` — the contract for sandboxed desktop mini-apps

The foundation of the custom-apps platform: a `moxxy-app.json` manifest schema
(id, ui entry, install assets + per-app host allow-list, declared permissions),
a closed capability list, the host↔app bridge protocol (typed postMessage RPC,
one permission per method), and the browser-side `connectMoxxyApp()` client an
app imports. Apps run as isolated web bundles in a cross-origin `moxxy-app://`
iframe and reach host services only through declared permissions — so the
manifest is the complete, auditable grant list. (Host discovery, the sandbox
surface, the anonymizer migration, and the create-app skill build on this.)
