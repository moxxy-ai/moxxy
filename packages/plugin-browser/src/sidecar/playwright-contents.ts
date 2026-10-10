import type { HostWebContents } from '../page/host.js';

/**
 * A Playwright page dressed as the slice of `WebContents` the browser host
 * drives, so the headless sidecar acts through the same `BrowserHost` as the
 * desktop: one implementation of a press, a type, a scroll, for both.
 *
 * Both are Chromium behind CDP; what differs is only how the channel is
 * reached — Electron's `webContents.debugger` there, a Playwright CDP session
 * here — and which page events stand for which.
 */

type Listener = (...args: never[]) => void;

/** The slice of a Playwright `Page` this needs (loosely typed: Playwright is an optional peer). */
export interface PlaywrightPage {
  url(): string;
  title(): Promise<string>;
  goto(url: string, opts?: unknown): Promise<unknown>;
  reload(): Promise<unknown>;
  goBack(): Promise<unknown>;
  goForward(): Promise<unknown>;
  bringToFront(): Promise<void>;
  isClosed(): boolean;
  mainFrame(): unknown;
  close(): Promise<void>;
  on(event: string, fn: Listener): unknown;
  off(event: string, fn: Listener): unknown;
}

/** A Playwright CDP session onto one page. */
export interface PlaywrightCdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, fn: (params: unknown) => void): unknown;
}

export interface PlaywrightContents extends HostWebContents {
  /** Read the title again; the host reads it synchronously, and a page may retitle itself at any time. */
  refreshTitle(): Promise<void>;
}

/** CDP events the host's page watch listens for. */
const FORWARDED = [
  'Page.javascriptDialogOpening',
  'Page.javascriptDialogClosed',
  'Page.frameStartedLoading',
  'Page.frameNavigated',
  'Page.loadEventFired',
  'Runtime.consoleAPICalled', 'Runtime.exceptionThrown',
  'Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed',
];

export function playwrightContents(id: number, page: PlaywrightPage, cdp: PlaywrightCdp): PlaywrightContents {
  let attached = false;
  let title = '';
  const messageListeners = new Set<(event: unknown, method: string, params: unknown) => void>();
  const pageListeners = new Map<Listener, [string, Listener]>();

  for (const method of FORWARDED) {
    cdp.on(method, (params) => {
      for (const fn of messageListeners) fn({}, method, params);
    });
  }
  // With a listener Playwright leaves a dialog open rather than dismissing it;
  // the host answers it over CDP — accepting an alert, holding a confirm for the agent.
  page.on('dialog', () => {});

  const refreshTitle = async (): Promise<void> => {
    try {
      title = page.isClosed() ? title : await page.title();
    } catch {
      // A page between documents has no title to give yet.
    }
  };

  /**
   * Electron's page events, as Playwright names them. A press or a key on a
   * headless page comes from the agent alone — there is nobody at it to take
   * it over — so the input events have no counterpart.
   */
  const translate = (event: string, fn: () => void): [string, Listener] | null => {
    switch (event) {
      case 'did-navigate':
        return ['framenavigated', ((frame: unknown) => frame === page.mainFrame() && fn()) as Listener];
      case 'page-title-updated':
        return ['load', (() => fn()) as Listener];
      default:
        return null;
    }
  };

  return {
    id,
    refreshTitle,
    getURL: () => page.url(),
    getTitle: () => title,
    isDestroyed: () => page.isClosed(),
    loadURL: async (url) => {
      await page.goto(url);
    },
    reload: () => void page.reload().catch(() => {}),
    navigationHistory: {
      canGoBack: () => true,
      canGoForward: () => true,
      goBack: () => void page.goBack().catch(() => {}),
      goForward: () => void page.goForward().catch(() => {}),
    },
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true;
      },
      detach: () => {
        attached = false;
      },
      sendCommand: (method, params, sessionId) => {
        if (sessionId) return Promise.reject(new Error('a frame from another site is not reachable in the headless browser'));
        return cdp.send(method, params ?? {});
      },
      on: (_event, fn) => {
        messageListeners.add(fn);
      },
      removeListener: (_event, fn) => {
        messageListeners.delete(fn);
      },
    },
    sendInputEvent: () => {},
    on: (event, fn) => {
      const mapped = translate(event, fn as () => void);
      if (!mapped) return;
      pageListeners.set(fn as Listener, mapped);
      page.on(mapped[0], mapped[1]);
    },
    removeListener: (_event, fn) => {
      const mapped = pageListeners.get(fn as Listener);
      if (!mapped) return;
      pageListeners.delete(fn as Listener);
      page.off(mapped[0], mapped[1]);
    },
    focus: () => void page.bringToFront().catch(() => {}),
  };
}
