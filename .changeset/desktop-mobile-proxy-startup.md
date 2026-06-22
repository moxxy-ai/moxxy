---
'@moxxy/desktop': patch
---

fix(desktop): app failed to start after the mobile proxy integration

The Start-mobile proxy wiring added a static top-level import of
`@moxxy/plugin-channel-mobile/e2e-proxy` to the Electron main. Because that
package is bundled into the main entry (it's in `BUNDLED_WORKSPACE_DEPS`), the
import pulled the E2E stack — and transitively `ulid` — into the main entry's
static module graph, reordering ESM init so `ulid`'s eager initialization ran
before electron-vite's injected `require` shim. `ulid` then threw "secure crypto
unusable, insecure Math.random not allowed" at boot, so the desktop app never
started.

Fix: load the proxy opener via a lazy `import()` (injected into
`MobileGatewayManager`) so the E2E stack stays out of the startup path and is
loaded only when the user enables the mobile gateway — in a `ulid`-free lazy
chunk, post `app.whenReady`. App startup is restored; the proxy "Start mobile"
behavior is unchanged.
