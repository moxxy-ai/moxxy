import { defineSurface, type SurfaceInstance } from '@moxxy/sdk';
import {
  browserSidecarCall,
  browserSidecarOnEvent,
  type BrowserSessionDeps,
} from './browser-session.js';

/**
 * The `browser` surface: a live, in-window view of the SAME Playwright page the
 * `browser_session` tool drives. Frames are pushed over a CDP screencast
 * (`Page.startScreencast` → `Page.screencastFrame`, JPEG) — a real stream that
 * only sends bytes when the page changes, not a fixed poll. The user's
 * clicks/keys/scroll/navigate are proxied back onto the page by coordinate. So
 * the agent and the user operate ONE shared page — agent navigations show up in
 * the pane, and the user can take over.
 *
 * Chromium-only (CDP). If the sidecar reports CDP is unavailable, the surface
 * still opens but no frames arrive; the agent's `browser_session` tool is
 * unaffected.
 */

export function buildBrowserSurface(deps?: BrowserSessionDeps) {
  return defineSurface({
    kind: 'browser',
    description: "A live view of the agent's browser; click, type, and navigate.",
    open: (): SurfaceInstance => {
      const dataSubs = new Set<(payload: unknown) => void>();
      let lastBase64: string | null = null;
      let lastUrl = '';
      // Page viewport, refreshed lazily so click coords map correctly.
      let vw = 1280;
      let vh = 800;

      const emit = (payload: unknown): void => {
        for (const cb of dataSubs) cb(payload);
      };

      // Push frames as the sidecar streams them.
      const offEvent = browserSidecarOnEvent((event) => {
        if (event.event !== 'screencastFrame') return;
        const data = typeof event.data === 'string' ? event.data : null;
        if (!data) return;
        lastBase64 = data;
        if (typeof event.url === 'string') lastUrl = event.url;
        emit({ type: 'frame', base64: data, mime: 'image/jpeg', url: lastUrl });
      }, deps);

      const refreshViewport = async (): Promise<void> => {
        try {
          const f = (await browserSidecarCall('frame', {}, deps)) as {
            width?: number;
            height?: number;
            url?: string;
          };
          if (f.width) vw = f.width;
          if (f.height) vh = f.height;
          if (typeof f.url === 'string') lastUrl = f.url;
        } catch {
          /* sidecar starting / page busy — keep last known size */
        }
      };

      // Kick the screencast + grab an initial frame/viewport (idempotent).
      void browserSidecarCall('startScreencast', {}, deps).catch(() => undefined);
      void refreshViewport();

      return {
        id: 'browser',
        kind: 'browser',
        onData: (cb) => {
          dataSubs.add(cb);
          return () => dataSubs.delete(cb);
        },
        snapshot: () =>
          lastBase64
            ? { type: 'frame', base64: lastBase64, mime: 'image/jpeg', url: lastUrl }
            : { type: 'frame', url: lastUrl },
        input: async (msg) => {
          if (msg.type === 'navigate' && typeof msg.url === 'string') {
            // The sidecar's goto re-runs the SSRF guard (loopback/private/
            // metadata blocked), so a hostile URL never navigates.
            await browserSidecarCall('goto', { url: msg.url }, deps).catch(() => undefined);
            void refreshViewport();
          } else if (msg.type === 'click' && typeof msg.fx === 'number' && typeof msg.fy === 'number') {
            await browserSidecarCall('mouse', { x: msg.fx * vw, y: msg.fy * vh }, deps).catch(() => undefined);
          } else if (msg.type === 'key' && typeof msg.key === 'string') {
            await browserSidecarCall('key', { key: msg.key }, deps).catch(() => undefined);
          } else if (msg.type === 'scroll' && typeof msg.dy === 'number') {
            await browserSidecarCall('scroll', { dy: msg.dy }, deps).catch(() => undefined);
          }
        },
        close: () => {
          offEvent();
          dataSubs.clear();
          // Stop the stream; the page stays alive for the agent's browser_session
          // tool (torn down on session shutdown via closeBrowserSidecar).
          void browserSidecarCall('stopScreencast', {}, deps).catch(() => undefined);
        },
      };
    },
  });
}
