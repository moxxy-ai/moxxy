---
"@moxxy/desktop-ipc-contract": patch
"@moxxy/desktop-host": patch
"@moxxy/desktop": patch
---

Desktop: make Clerk sign-in work in the packaged app, and add a `moxxy://`
deep-link.

Sign-in failed in the packaged build with `prohibited_redirect_url`: the
renderer was served from `file://`, so clerk-js derived a `file://` OAuth
redirect, which Clerk rejects (only `http(s)` schemes are allowed). It worked
in dev only because Vite serves `http://localhost`.

The packaged renderer is now served from a hardened in-process loopback HTTP
server (`http://127.0.0.1:<port>`, 127.0.0.1-only, fixed port list, GET/HEAD
only, path-traversal + Host-header guards, SPA fallback). A loopback origin is
a Chromium *secure context* and an allowed OAuth redirect scheme, so the
existing `clerk.openSignIn()` modal + OAuth popup work as they do on the web.
The CSP gate now matches the loopback origin (directives unchanged — clerk-js
still loads from the instance's Frontend API host), the focus widget loads from
the same origin, and OAuth popups get a clean desktop-Chrome user-agent (no
Electron/app tokens) to avoid Google's embedded-webview block. If every
loopback port is taken, it falls back to `file://` (the window still renders).

Also adds a `moxxy://` custom-protocol deep-link as general-purpose transport
(single-instance lock + protocol registration + `open-url`/`second-instance`
capture → a typed `deepLink:received` IPC event, with cold-start links buffered
and drained via `deepLink:drain` on mount). Nothing routes on it yet — it's the
plumbing for notification + action links.

Owner action: add the loopback origins (`http://127.0.0.1` and
`http://localhost` on the configured ports) to the Clerk dashboard's allowed
origins / redirect URLs for the production instance.
