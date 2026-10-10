import type { HostWebContents } from './host.js';

/**
 * A real Chromium tab dressed as the slice of `WebContents` the host drives.
 *
 * Test support only. What the host gets wrong is how Chromium answers — whether
 * Enter submits, whether a covered button takes the click, whether `alert()`
 * blocks the press — and a recorded stand-in cannot say any of that. Electron's
 * guest view is Chromium behind the same CDP, so a Playwright tab is the closest
 * thing to it that runs without a window.
 *
 * Not exported from the package; `chromiumAvailable()` lets a suite skip on a
 * machine with no browser installed rather than fail.
 */

type Listener = (...args: unknown[]) => void;

interface PlaywrightPage {
  url(): string;
  title(): Promise<string>;
  goto(url: string): Promise<unknown>;
  reload(): Promise<unknown>;
  goBack(): Promise<unknown>;
  goForward(): Promise<unknown>;
  setContent(html: string): Promise<void>;
  evaluate<T>(fn: string): Promise<T>;
  bringToFront(): Promise<void>;
  mainFrame(): unknown;
  on(event: string, fn: Listener): void;
  close(): Promise<void>;
}

interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, fn: (params: unknown) => void): void;
  detach(): Promise<void>;
}

/** CDP events the host may listen for through `debugger.on('message')`. */
const FORWARDED = [
  'Page.javascriptDialogOpening',
  'Page.javascriptDialogClosed',
  'Page.frameStartedLoading',
  'Page.frameNavigated',
  'Page.loadEventFired',
  'Runtime.consoleAPICalled', 'Runtime.exceptionThrown',
  'Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed',
];

export interface ChromiumTab {
  readonly wc: HostWebContents;
  /** Load a page from a string; resolves once it has loaded. */
  show(html: string): Promise<void>;
  /** Read something back from the page. */
  read<T>(expression: string): Promise<T>;
  /** Pages the tab opened (window.open, target=_blank), by URL. */
  readonly popups: string[];
  close(): Promise<void>;
}

let launched: Promise<{ newContext(): Promise<{ newPage(): Promise<unknown>; newCDPSession(page: unknown): Promise<unknown> }>; close(): Promise<void> }> | null = null;

async function browser(): Promise<NonNullable<Awaited<typeof launched>>> {
  launched ??= import('playwright').then(({ chromium }) => chromium.launch({ headless: true })) as typeof launched;
  const b = await launched;
  if (!b) throw new Error('chromium did not launch');
  return b;
}

/**
 * Where Playwright keeps its browsers, from the account's real home.
 *
 * The test preset moves HOME to a temp dir so no test touches ~/.moxxy, and
 * Playwright resolves its cache from HOME — so without this it looks in the temp
 * dir, finds nothing, and every suite here silently skips.
 */
async function pointAtBrowserCache(): Promise<void> {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  const { userInfo } = await import('node:os');
  const { join } = await import('node:path');
  const home = userInfo().homedir;
  if (process.platform === 'darwin') process.env.PLAYWRIGHT_BROWSERS_PATH = join(home, 'Library', 'Caches', 'ms-playwright');
  else if (process.platform === 'linux') process.env.PLAYWRIGHT_BROWSERS_PATH = join(home, '.cache', 'ms-playwright');
  // Windows resolves from LOCALAPPDATA, which the preset leaves alone.
}

/** Whether a Chromium is installed for Playwright on this machine. */
export async function chromiumAvailable(): Promise<boolean> {
  try {
    await pointAtBrowserCache();
    const { chromium } = await import('playwright');
    const { existsSync } = await import('node:fs');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export async function closeChromium(): Promise<void> {
  const b = launched;
  launched = null;
  if (b) await (await b).close();
}

export async function openChromiumTab(id = 1): Promise<ChromiumTab> {
  const context = await (await browser()).newContext();
  const page = (await context.newPage()) as PlaywrightPage;
  const session = (await context.newCDPSession(page)) as CdpSession;
  let attached = false;
  let title = '';
  const popups: string[] = [];
  const messageListeners = new Set<Listener>();
  const pageListeners = new Map<string, Map<Listener, Listener>>();

  for (const method of FORWARDED) {
    session.on(method, (params) => {
      for (const fn of messageListeners) fn({}, method, params);
    });
  }
  const refreshTitle = (): void => {
    void page.title().then((t) => (title = t), () => {});
  };
  page.on('load', refreshTitle);
  page.on('domcontentloaded', refreshTitle);
  page.on('popup', (popup) => popups.push((popup as PlaywrightPage).url()));
  // A dialog nobody answers would park the page forever; the host is expected
  // to answer through CDP, so Playwright must not auto-dismiss it first.
  page.on('dialog', () => {});

  /** Electron's page events, mapped onto Playwright's. */
  const translate = (event: string, fn: Listener): [string, Listener] | null => {
    switch (event) {
      case 'did-navigate':
        return ['framenavigated', (frame) => frame === page.mainFrame() && fn()];
      case 'did-stop-loading':
        return ['load', () => fn()];
      case 'page-title-updated':
        return ['load', () => fn()];
      default:
        return null;
    }
  };

  const wc: HostWebContents = {
    id,
    getURL: () => page.url(),
    getTitle: () => title,
    isDestroyed: () => false,
    loadURL: async (url) => {
      await page.goto(url);
    },
    reload: () => void page.reload(),
    navigationHistory: {
      canGoBack: () => true,
      canGoForward: () => true,
      goBack: () => void page.goBack(),
      goForward: () => void page.goForward(),
    },
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true;
      },
      detach: () => {
        attached = false;
      },
      sendCommand: (method, params) => session.send(method, params ?? {}),
      on: (_event, fn) => {
        messageListeners.add(fn as Listener);
      },
      removeListener: (_event, fn) => {
        messageListeners.delete(fn as Listener);
      },
    },
    sendInputEvent: () => {},
    on: (event, fn) => {
      const mapped = translate(event, fn);
      if (!mapped) return;
      const byFn = pageListeners.get(event) ?? new Map<Listener, Listener>();
      byFn.set(fn, mapped[1]);
      pageListeners.set(event, byFn);
      page.on(mapped[0], mapped[1]);
    },
    removeListener: (event, fn) => {
      const mapped = pageListeners.get(event)?.get(fn);
      if (!mapped) return;
      pageListeners.get(event)?.delete(fn);
      (page as unknown as { off(e: string, f: Listener): void }).off(translate(event, fn)?.[0] ?? event, mapped);
    },
    focus: () => void page.bringToFront(),
  };

  return {
    wc,
    popups,
    show: async (html) => {
      await page.setContent(html);
      title = await page.title();
    },
    read: (expression) => page.evaluate(expression),
    close: async () => {
      await session.detach().catch(() => {});
      await page.close();
    },
  };
}
