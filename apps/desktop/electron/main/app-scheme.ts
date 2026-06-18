/**
 * Registration of the local-only `moxxy-app://` app-asset scheme.
 *
 * Electron only honors `protocol.registerSchemesAsPrivileged` BEFORE the app
 * `ready` event. In a packaged build the real main (`index.ts`) is loaded by the
 * immutable bootstrap via a dynamic `import()` that runs AFTER `app.whenReady()`
 * (the bootstrap awaits bundle resolution + the import before the override's
 * module body executes). So a top-level `registerSchemesAsPrivileged` call inside
 * the hot-updatable `index.ts` runs post-ready and throws
 *   "protocol.registerSchemesAsPrivileged should be called before app is ready"
 * — which crashes the override main on load, poisons the freshly hot-updated
 * bundle, and reverts the app to the baked floor (observed live as a 0.10 → 0.8
 * downgrade). The privileged registration therefore MUST happen from the
 * bootstrap's synchronous prologue — the one piece of the app guaranteed to run
 * pre-ready — NOT from `index.ts`.
 *
 * Single-sourced here so the bootstrap and `index.ts` can never disagree on the
 * scheme's privileges.
 */
import { app, protocol } from 'electron';

/** The local-only app-asset scheme. MUST equal `@moxxy/desktop-host`'s
 *  `APP_ASSET_SCHEME`. Duplicated here as a bare string (rather than imported)
 *  so the immutable bootstrap stays free of the desktop-host barrel — the same
 *  discipline as the hand-duplicated `compareSemver` baked into the bootstrap. */
export const APP_ASSET_SCHEME = 'moxxy-app';

/**
 * Register `moxxy-app://` as a privileged standard + secure scheme that the
 * renderer (and its workers) can fetch/stream under CSP. A no-op once the app is
 * ready — calling `registerSchemesAsPrivileged` post-ready throws, and by then
 * the bootstrap's pre-ready call has already registered it — so it is safe to
 * call from BOTH the bootstrap prologue (the authoritative pre-ready call) and a
 * defensive fallback in `index.ts` (for a non-bootstrap entry, e.g. a test).
 */
export function registerAppAssetSchemePrivileged(): void {
  // Too late to register (and it would throw): the bootstrap already did it
  // pre-ready. Nothing to do.
  if (app.isReady()) return;
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}
