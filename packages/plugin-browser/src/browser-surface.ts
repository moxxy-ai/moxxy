import { defineSurface, type SurfaceInstance } from '@moxxy/sdk';
import {
  browserSidecarCall,
  closeBrowserSidecar,
  resolveBrowserInstallRoot,
  sidecarErrorKind,
  type BrowserSessionDeps,
} from './browser-session.js';
import { installPlaywrightPackage } from './sidecar/install.js';

/**
 * The `browser` surface: a live, in-window view of the SAME Playwright page the
 * `browser_session` tool drives. We "stream" the page by polling a JPEG frame
 * (`frame` sidecar method) a few times a second and forwarding it as a
 * `surface.data` payload; the user's clicks/keys/scroll/navigate are proxied
 * back onto the page via the sidecar's coordinate-based input methods. So the
 * agent and the user operate ONE shared page — agent navigations show up in the
 * pane, and the user can take over.
 *
 * Why polling and not a CDP `Page.startScreencast` push: the screencast only
 * emits on visual change, so a freshly-opened (blank / static / headless) page
 * produces no frames at all — the pane sat on "Loading…" forever with the
 * underlying error swallowed. A screenshot poll always yields a frame (even a
 * blank one), so the view comes up reliably and a real launch/install failure
 * surfaces as a status line instead of an indefinite spinner. Polling rides the
 * existing sidecar RPC surface and works on every Playwright browser, not just
 * Chromium.
 */

const FRAME_INTERVAL_MS = 300;
/** Consecutive `frame` failures (with no frame ever seen) before we stop
 *  assuming "still launching" and show the error. ~6 × 300ms ≈ 1.8s grace. */
const FAIL_GRACE = 6;

interface Frame {
  mediaType: string;
  base64: string;
  url: string;
  width: number;
  height: number;
}

/** Validate a sidecar `frame` reply before emitting it: a partial / altered
 *  reply must be treated as a failed tick (so FAIL_GRACE eventually surfaces a
 *  status) rather than streamed to subscribers as `{base64: undefined, …}`. */
function isFrame(v: unknown): v is Frame {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return typeof f.base64 === 'string' && typeof f.mediaType === 'string' && typeof f.url === 'string';
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
      let fails = 0;
      // Set once we detect the `playwright` npm package isn't installed. Polling
      // pauses (no point retrying an import that will keep failing) and the pane
      // shows an Install affordance; an `install` input clears it.
      let needsInstall = false;
      let installing = false;

      const emit = (payload: unknown): void => {
        for (const cb of dataSubs) cb(payload);
      };

      const stopPolling = (): void => {
        if (timer) clearInterval(timer);
        timer = null;
      };
      const startPolling = (): void => {
        if (timer) return;
        void tick();
        timer = setInterval(() => void tick(), FRAME_INTERVAL_MS);
      };

      const tick = async (): Promise<void> => {
        if (inFlight || needsInstall || installing) return; // don't pile up / retry a known-missing dep
        inFlight = true;
        try {
          const reply = await browserSidecarCall('frame', {}, deps);
          if (!isFrame(reply)) throw new Error('malformed frame reply from sidecar');
          last = reply;
          fails = 0;
          emit({ type: 'frame', base64: reply.base64, mime: reply.mediaType, url: reply.url });
        } catch (err) {
          // The `playwright` npm package is simply absent — recoverable. Pause
          // polling and ask the user (the download is ~200MB) rather than spin on
          // a failing import or dump a raw "not installed" error.
          if (sidecarErrorKind(err) === 'needs-install') {
            needsInstall = true;
            stopPolling();
            emit({
              type: 'status',
              needsInstall: true,
              text: 'The browser engine (Playwright) is not installed. It is a one-time ~200MB download.',
            });
            return;
          }
          // The first failures are usually the browser still launching (or a
          // one-time binary install). Only surface a hard error once it's
          // clearly not transient, so the user isn't left on a silent spinner.
          // Fire EXACTLY on the FAIL_GRACE-th consecutive failure (a successful
          // frame resets `fails` to 0), so the status is emitted once per
          // failure streak rather than every tick. We surface it whether or not
          // a prior frame exists: with no frame yet the page never came up;
          // with a prior frame the page later died and the pane would otherwise
          // sit frozen on a stale screenshot with no hint the live view is dead.
          if (++fails === FAIL_GRACE) {
            const message = err instanceof Error ? err.message : String(err);
            emit({
              type: 'status',
              text: last ? `Browser disconnected: ${message}` : `Browser unavailable: ${message}`,
            });
          }
        } finally {
          inFlight = false;
        }
      };

      // After an interaction, grab a frame now and once more shortly after, so a
      // click/keypress that kicks off async work (a navigation, a menu opening,
      // an animation) shows up promptly instead of waiting for the next poll.
      const bump = (): void => {
        void tick();
        setTimeout(() => void tick(), 140);
      };

      // Kick an immediate frame (launches the browser), then poll.
      startPolling();

      const runInstall = async (): Promise<void> => {
        if (installing) return;
        installing = true;
        stopPolling();
        emit({ type: 'status', text: 'Installing browser engine… (one-time, ~200MB)' });
        try {
          await installPlaywrightPackage({
            rootDir: resolveBrowserInstallRoot(deps),
            onProgress: (line) => emit({ type: 'status', text: line }),
          });
          // The sidecar cached its failed `import('playwright')`; drop it so the
          // next frame call respawns a fresh sidecar that imports the now-present
          // package.
          await closeBrowserSidecar();
          needsInstall = false;
          fails = 0;
          emit({ type: 'status', text: 'Installed. Starting browser…' });
          startPolling();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emit({ type: 'status', needsInstall: true, text: `Install failed: ${message}` });
        } finally {
          installing = false;
        }
      };

      return {
        id: 'browser',
        kind: 'browser',
        onData: (cb) => {
          dataSubs.add(cb);
          return () => dataSubs.delete(cb);
        },
        snapshot: () =>
          needsInstall
            ? {
                type: 'status',
                needsInstall: true,
                text: 'The browser engine (Playwright) is not installed. It is a one-time ~200MB download.',
              }
            : last
              ? { type: 'frame', base64: last.base64, mime: last.mediaType, url: last.url }
              : { type: 'status', text: 'Starting browser…' },
        resize: async (size) => {
          // Match the page viewport to the pane so the live view fills the
          // container (no letterboxing) and click coords map 1:1.
          if (!size.width || !size.height) return;
          await browserSidecarCall('setviewport', { width: size.width, height: size.height }, deps).catch(
            () => undefined,
          );
          void tick();
        },
        input: async (msg) => {
          if (msg.type === 'install') {
            await runInstall();
            return;
          }
          const vw = last?.width ?? 1280;
          const vh = last?.height ?? 720;
          if (msg.type === 'navigate' && typeof msg.url === 'string') {
            // The sidecar's goto re-runs the SSRF guard (loopback/private/
            // metadata blocked), so a hostile URL never navigates. Unlike the
            // pointer/key proxies below, a navigate rejection is user-meaningful
            // (bad URL format, SSRF block) — surface it as a status line instead
            // of swallowing it, so the user knows why the address bar did nothing.
            try {
              await browserSidecarCall('goto', { url: msg.url }, deps);
            } catch (err) {
              const text = err instanceof Error ? err.message : String(err);
              emit({ type: 'status', text });
            }
            bump();
          } else if (
            (msg.type === 'click' || msg.type === 'dblclick') &&
            typeof msg.fx === 'number' &&
            typeof msg.fy === 'number'
          ) {
            const count = msg.type === 'dblclick' ? 2 : 1;
            await browserSidecarCall('mouse', { x: msg.fx * vw, y: msg.fy * vh, count }, deps).catch(
              () => undefined,
            );
            bump();
          } else if (msg.type === 'move' && typeof msg.fx === 'number' && typeof msg.fy === 'number') {
            // Hover — drive the pointer so :hover styles/tooltips render. A single
            // follow-up frame (not a bump) keeps the cost down at move frequency.
            await browserSidecarCall('mousemove', { x: msg.fx * vw, y: msg.fy * vh }, deps).catch(
              () => undefined,
            );
            void tick();
          } else if (
            msg.type === 'capture' &&
            typeof msg.fx === 'number' &&
            typeof msg.fy === 'number' &&
            typeof msg.fw === 'number' &&
            typeof msg.fh === 'number'
          ) {
            // Sharp PNG of the dragged region → handed back to the pane, which
            // attaches it to the chat composer (the user then describes the change).
            const shot = (await browserSidecarCall(
              'capture',
              { x: msg.fx * vw, y: msg.fy * vh, width: msg.fw * vw, height: msg.fh * vh },
              deps,
            ).catch(() => null)) as unknown;
            // Validate before emitting so a partial/altered reply doesn't hand
            // the composer a {base64: undefined} attachment.
            if (
              shot &&
              typeof shot === 'object' &&
              typeof (shot as { base64?: unknown }).base64 === 'string' &&
              typeof (shot as { mediaType?: unknown }).mediaType === 'string'
            ) {
              const s = shot as { base64: string; mediaType: string };
              emit({ type: 'captured', base64: s.base64, mediaType: s.mediaType });
            }
          } else if (msg.type === 'zoom' && typeof msg.factor === 'number') {
            await browserSidecarCall('zoom', { factor: msg.factor }, deps).catch(() => undefined);
            bump();
          } else if (msg.type === 'key' && typeof msg.key === 'string') {
            await browserSidecarCall('key', { key: msg.key }, deps).catch(() => undefined);
            bump();
          } else if (msg.type === 'scroll' && typeof msg.dy === 'number') {
            await browserSidecarCall('scroll', { dy: msg.dy }, deps).catch(() => undefined);
            bump();
          } else if (msg.type === 'back' || msg.type === 'forward' || msg.type === 'reload') {
            await browserSidecarCall(msg.type, {}, deps).catch(() => undefined);
            bump();
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
