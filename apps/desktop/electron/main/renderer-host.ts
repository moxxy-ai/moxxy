import type { App } from 'electron';

/**
 * The hostname the packaged renderer is served on.
 *
 * Duplicated from `DESKTOP_APP_HOST` in `@moxxy/desktop-host` rather than
 * imported: this runs in the bootstrap's synchronous prologue, which is the
 * immutable floor, and importing the host barrel there drags the whole main
 * process in before `app` is ready. That has crashed boot before. A test keeps
 * the two literals in agreement, which a comment would not.
 */
export const RENDERER_HOST = 'desktop.moxxy.ai';

/**
 * Resolve the renderer's hostname to loopback inside Chromium, without DNS.
 *
 * The renderer is served from a loopback HTTPS server but must carry a
 * `moxxy.ai` Origin, because a Clerk production key rejects anything else.
 * That was achieved with a public A-record pointing `desktop.moxxy.ai` at
 * 127.0.0.1, which made every installed copy depend on one DNS record staying
 * alive: when it stopped resolving, every app opened to a blank window with
 * only `ERR_NAME_NOT_RESOLVED` in a log nobody reads. It also meant the app
 * could not open on a plane, on a filtered corporate resolver, or anywhere DNS
 * was slow.
 *
 * Mapping it here removes the dependency entirely. It is also strictly safer:
 * the name can no longer be pointed anywhere by whoever controls the zone.
 *
 * MUST be called before `app` is ready; Chromium reads this switch at network
 * stack init. Kept in the floor so a bad hot-update cannot remove the one rule
 * the app needs to load its own UI.
 */
export function pinRendererHostToLoopback(electronApp: App): void {
  const existing = electronApp.commandLine.getSwitchValue('host-resolver-rules');
  const rule = `MAP ${RENDERER_HOST} 127.0.0.1`;
  // Append rather than overwrite: an operator debugging with their own
  // --host-resolver-rules should not silently lose it, and Chromium applies
  // the first matching rule, so theirs still wins for other hosts.
  electronApp.commandLine.appendSwitch(
    'host-resolver-rules',
    existing ? `${existing},${rule}` : rule,
  );
}
