---
"@moxxy/desktop-host": patch
"@moxxy/desktop": patch
---

fix(desktop): app failed to start after the Apps Webhooks panel (#338)

#338 registered the webhooks IPC with a static top-level
`import … from '@moxxy/plugin-webhooks'` in `@moxxy/desktop-host`, which is
bundled into the Electron main entry (`BUNDLED_WORKSPACE_DEPS`). That dragged
the webhooks plugin's proxy/E2E stack and, transitively, `ulid` into the main
entry's eager module graph, reordering ESM init so `ulid` initialised before
electron-vite's injected `require` shim. `ulid` then threw "secure crypto
unusable, insecure Math.random not allowed" at boot, so the updated bundle
(0.23.0) load-errored and fell back to the floor — the identical regression the
0.22.3 mobile-proxy fix addressed.

Fix: defer the webhooks plugin to a lazy `import()` inside the IPC handlers
(only the erased `import type` stays static), so the proxy/E2E stack + `ulid`
load on the first `webhooks.*` call — post `app.whenReady`, out of the startup
path. App startup is restored; the Webhooks panel is unchanged.
