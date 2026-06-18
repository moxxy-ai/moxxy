/**
 * `moxxy://` deep-link transport for the Electron main process.
 *
 * Extracted from `index.ts` so the URL parsing is a pure, testable unit and the
 * cold-start buffering lives in one small router instead of as free-floating
 * module singletons. Behavior is unchanged: links that arrive before the
 * renderer's `DeepLinkBridge` has drained are buffered and replayed on the next
 * `deepLink:drain`; live links thereafter push straight through.
 */
import type { BrowserWindow } from 'electron';
import { sendEvent } from '@moxxy/desktop-host';
import type { DeepLinkPayload } from '@moxxy/desktop-ipc-contract';

/** Parse a `moxxy://host/path?a=b` URL into its transport payload, or null
 *  if it isn't a well-formed moxxy URL. */
export function parseDeepLink(url: string): DeepLinkPayload | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'moxxy:') return null;
    const params: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      params[k] = v;
    });
    return { url, host: u.hostname, path: u.pathname || '/', params };
  } catch {
    return null;
  }
}

/**
 * Owns the cold-start buffer + the renderer-ready flag for deep-links.
 *
 * `focus` brings the window to the foreground; `getWindow` returns the current
 * main window (or null/destroyed). Both are injected so this stays decoupled
 * from the module-level `mainWindow` singleton the entry point keeps.
 */
export class DeepLinkRouter {
  /** `moxxy://` links that arrived before the renderer's DeepLinkBridge was
   *  listening (cold-start launch, or before the bridge mounted). Drained via
   *  the `deepLink:drain` IPC on mount; live links thereafter push directly. */
  private readonly pending: DeepLinkPayload[] = [];
  /** Flips true once the renderer's bridge drains. Reset on every (re)load so
   *  links re-buffer. */
  private rendererReady = false;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly focus: () => void,
  ) {}

  /** Reset the ready flag (call on `did-start-loading`) so links re-buffer
   *  across a load / reload and none are lost. */
  markLoading(): void {
    this.rendererReady = false;
  }

  /** The renderer's DeepLinkBridge calls this once on mount: returns + clears
   *  any links buffered before the renderer was listening (cold-start), and
   *  flips the ready flag so subsequent links push live. */
  drain(): DeepLinkPayload[] {
    this.rendererReady = true;
    return this.pending.splice(0);
  }

  /** Route an opened `moxxy://` URL: focus the window, then push it to the
   *  renderer live (if the bridge is listening) or buffer it for the next
   *  drain. */
  handle(url: string): void {
    const payload = parseDeepLink(url);
    if (!payload) return;
    this.focus();
    const win = this.getWindow();
    if (this.rendererReady && win && !win.isDestroyed()) {
      sendEvent(win, 'deepLink:received', payload);
    } else {
      this.pending.push(payload);
    }
  }
}
