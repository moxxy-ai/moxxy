import { defineSurface, type SurfaceInstance } from '@moxxy/sdk';
import { browserSidecarCall, type BrowserSessionDeps } from './browser-session.js';

/**
 * The `browser` surface: a live, in-window view of the SAME Playwright page the
 * `browser_session` tool drives. We "stream" the page by polling a JPEG frame
 * (`frame` sidecar method) a few times a second and forwarding it as a
 * `surface.data` payload; the user's clicks/keys/scroll/navigate are proxied
 * back onto the page via the sidecar's coordinate-based input methods. So the
 * agent and the user operate ONE shared page — agent navigations show up in the
 * pane, and the user can take over.
 *
 * Polling (vs CDP screencast) keeps this entirely within the existing sidecar
 * RPC surface; a future enhancement can swap in `Page.startScreencast` for a
 * true push stream.
 */

const FRAME_INTERVAL_MS = 450;

interface Frame {
  mediaType: string;
  base64: string;
  url: string;
  width: number;
  height: number;
}

export function buildBrowserSurface(deps?: BrowserSessionDeps) {
  return defineSurface({
    kind: 'browser',
    description: "A live view of the agent's browser; click, type, and navigate.",
    open: (): SurfaceInstance => {
      const dataSubs = new Set<(payload: unknown) => void>();
      let last: Frame | null = null;
      let timer: ReturnType<typeof setInterval> | null = null;
      let inFlight = false;

      const emit = (payload: unknown): void => {
        for (const cb of dataSubs) cb(payload);
      };

      const tick = async (): Promise<void> => {
        if (inFlight) return; // don't pile up frames if the page is busy
        inFlight = true;
        try {
          const frame = (await browserSidecarCall('frame', {}, deps)) as Frame;
          last = frame;
          emit({ type: 'frame', base64: frame.base64, mime: frame.mediaType, url: frame.url });
        } catch {
          // Transient (page mid-navigation, sidecar starting) — skip this frame.
        } finally {
          inFlight = false;
        }
      };

      const start = (): void => {
        if (timer) return;
        // Kick an immediate frame, then poll.
        void tick();
        timer = setInterval(() => void tick(), FRAME_INTERVAL_MS);
      };
      start();

      return {
        id: 'browser',
        kind: 'browser',
        onData: (cb) => {
          dataSubs.add(cb);
          return () => dataSubs.delete(cb);
        },
        snapshot: () =>
          last
            ? { type: 'frame', base64: last.base64, mime: last.mediaType, url: last.url }
            : { type: 'frame' },
        input: async (msg) => {
          const vw = last?.width ?? 1280;
          const vh = last?.height ?? 720;
          if (msg.type === 'navigate' && typeof msg.url === 'string') {
            // The sidecar's goto re-runs the SSRF guard (loopback/private/
            // metadata blocked), so a hostile URL never navigates.
            await browserSidecarCall('goto', { url: msg.url }, deps).catch(() => undefined);
            void tick();
          } else if (msg.type === 'click' && typeof msg.fx === 'number' && typeof msg.fy === 'number') {
            await browserSidecarCall('mouse', { x: msg.fx * vw, y: msg.fy * vh }, deps).catch(() => undefined);
            void tick();
          } else if (msg.type === 'key' && typeof msg.key === 'string') {
            await browserSidecarCall('key', { key: msg.key }, deps).catch(() => undefined);
            void tick();
          } else if (msg.type === 'scroll' && typeof msg.dy === 'number') {
            await browserSidecarCall('scroll', { dy: msg.dy }, deps).catch(() => undefined);
            void tick();
          }
        },
        close: () => {
          if (timer) clearInterval(timer);
          timer = null;
          dataSubs.clear();
          // The underlying page stays alive for the agent's browser_session tool;
          // it's torn down on session shutdown (closeBrowserSidecar).
        },
      };
    },
  });
}
