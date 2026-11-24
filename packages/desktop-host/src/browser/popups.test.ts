import { describe, expect, it } from 'vitest';
import { routeGuestPopups, type PopupHost, type PopupRequest, type PopupSource } from './popups.js';

/**
 * A page in the pane asking for a new window — `target=_blank`, `window.open`.
 *
 * Left to Electron it became a bare window of its own, beside the app and
 * outside the pane: the user saw something pop up somewhere else, and the agent,
 * whose click had opened it, saw nothing happen at all. So a link that asks for
 * a new tab gets one in the pane.
 *
 * A popup is different. A sign-in through Google, Apple or Microsoft opens a
 * small window with `window.open(url, name, 'width=…,height=…')`, and the page
 * waits for that window to hand the result back through `window.opener` and
 * close. Made into a tab it had no opener: the page heard "popup blocked"
 * straight away, and the person finished signing in in a tab that went nowhere
 * (seen live on ElevenLabs: "Unable to sign in", MOXXY-5).
 */

/** A window in these tests: a plain object, or a popup carrying its web contents. */
type FakeWindow = { readonly name?: string; readonly webContents?: PopupSource<FakeWindow> };
type Handler = Parameters<PopupSource<FakeWindow>['setWindowOpenHandler']>[0];
type CreatedListener = (window: FakeWindow & { webContents: PopupSource<FakeWindow> }) => void;

function contents(type: string, id = 7) {
  let handler: Handler | null = null;
  const created: CreatedListener[] = [];
  const source: PopupSource<FakeWindow> & { on: (event: 'did-create-window', listener: CreatedListener) => unknown } = {
    id,
    getType: () => type,
    setWindowOpenHandler: (fn: Handler) => {
      handler = fn;
    },
    on: (event: 'did-create-window', listener: CreatedListener) => {
      if (event === 'did-create-window') created.push(listener);
      return source;
    },
  };
  return {
    source,
    open: (details: Partial<PopupRequest> & { url: string }) =>
      handler ? handler({ disposition: 'foreground-tab', features: '', ...details }) : null,
    /** Electron made the window this source asked for. */
    created: (window: { webContents: PopupSource<FakeWindow> }) => created.forEach((listener) => listener(window)),
  };
}

function recordingHost() {
  const tabs: Array<[number, string]> = [];
  const windows: Array<[number, string]> = [];
  const host: PopupHost = {
    openFromPage: (id, url) => tabs.push([id, url]),
    openedWindowFromPage: (id, url) => windows.push([id, url]),
  };
  return { host, tabs, windows };
}

const APP_WINDOW: FakeWindow = { name: 'the app window' };

describe('routeGuestPopups — a new tab', () => {
  it('turns a link that asks for a new tab into a tab in the pane, and opens no window', () => {
    const { host, tabs, windows } = recordingHost();
    const guest = contents('webview');

    routeGuestPopups(guest.source, host, () => APP_WINDOW);

    expect(guest.open({ url: 'https://example.org/' })).toEqual({ action: 'deny' });
    expect(tabs).toEqual([[7, 'https://example.org/']]);
    expect(windows).toEqual([]);
  });

  it('keeps a shift-click (a new window with no size asked for) a tab', () => {
    const { host, tabs } = recordingHost();
    const guest = contents('webview');

    routeGuestPopups(guest.source, host, () => APP_WINDOW);

    expect(guest.open({ url: 'https://example.org/', disposition: 'new-window', features: '' })).toEqual({
      action: 'deny',
    });
    expect(tabs).toEqual([[7, 'https://example.org/']]);
  });

  it('keeps a popup that gives up its opener a tab: there is nothing for it to hand back', () => {
    const { host, tabs, windows } = recordingHost();
    const guest = contents('webview');

    routeGuestPopups(guest.source, host, () => APP_WINDOW);

    const asked = { url: 'https://example.org/', disposition: 'new-window', features: 'noopener,width=500,height=600' };
    expect(guest.open(asked)).toEqual({ action: 'deny' });
    expect(tabs).toEqual([[7, 'https://example.org/']]);
    expect(windows).toEqual([]);
  });

  it('leaves the app’s own windows to their own rules', () => {
    const { host, tabs } = recordingHost();
    const window = contents('window');

    routeGuestPopups(window.source, host, () => APP_WINDOW);

    expect(window.open({ url: 'https://example.org/' })).toBeNull();
    expect(tabs).toEqual([]);
  });

  it('opens nothing for an address that is not a web page', () => {
    const { host, tabs, windows } = recordingHost();
    const guest = contents('webview');

    routeGuestPopups(guest.source, host, () => APP_WINDOW);

    expect(guest.open({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    expect(guest.open({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(guest.open({ url: 'file:///etc/passwd', disposition: 'new-window', features: 'width=500' })).toEqual({
      action: 'deny',
    });
    expect(tabs).toEqual([]);
    expect(windows).toEqual([]);
  });
});

describe('routeGuestPopups — a sign-in popup', () => {
  const SIGN_IN = {
    url: 'https://accounts.google.com/o/oauth2/auth?client_id=x',
    disposition: 'new-window',
    features: 'width=500,height=600,top=100,left=100',
  };

  it('opens as a real popup of the page, over the app window, so it can hand the result back and close', () => {
    const { host, tabs, windows } = recordingHost();
    const guest = contents('webview');

    routeGuestPopups(guest.source, host, () => APP_WINDOW);
    const decision = guest.open(SIGN_IN);

    expect(decision).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: { parent: APP_WINDOW } });
    expect(tabs).toEqual([]);
    expect(windows).toEqual([[7, SIGN_IN.url]]);
  });

  it('keeps the popup a plain web page: no preload, no Node, sandboxed, no webviews of its own', () => {
    const { host } = recordingHost();
    const guest = contents('webview');

    routeGuestPopups(guest.source, host, () => APP_WINDOW);
    const decision = guest.open(SIGN_IN) as { overrideBrowserWindowOptions: { webPreferences: Record<string, unknown> } };

    expect(decision.overrideBrowserWindowOptions.webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      preload: undefined,
    });
  });

  it('lets a popup start blank, as sign-in libraries do before they send it to the provider', () => {
    const { host, windows } = recordingHost();
    const guest = contents('webview');

    routeGuestPopups(guest.source, host, () => APP_WINDOW);

    expect(guest.open({ ...SIGN_IN, url: 'about:blank' })).toMatchObject({ action: 'allow' });
    expect(windows).toEqual([[7, 'about:blank']]);
  });

  it('gives the popup the same rules: its own popup sits over it, its links still become tabs', () => {
    const { host, tabs, windows } = recordingHost();
    const guest = contents('webview');
    routeGuestPopups(guest.source, host, () => APP_WINDOW);
    guest.open(SIGN_IN);

    const popup = contents('window', 9);
    const popupWindow = { webContents: popup.source };
    guest.created(popupWindow);

    const nested = popup.open(SIGN_IN) as { overrideBrowserWindowOptions: { parent: unknown } };
    expect(nested).toMatchObject({ action: 'allow' });
    expect(nested.overrideBrowserWindowOptions.parent).toBe(popupWindow);
    expect(popup.open({ url: 'https://example.org/help' })).toEqual({ action: 'deny' });
    expect(popup.open({ url: 'file:///etc/passwd', disposition: 'new-window', features: 'width=1' })).toEqual({
      action: 'deny',
    });
    expect(windows).toEqual([
      [7, SIGN_IN.url],
      [9, SIGN_IN.url],
    ]);
    expect(tabs).toEqual([[9, 'https://example.org/help']]);
  });

  it('opens the popup as a tab when there is no app window to put it over', () => {
    const { host, tabs, windows } = recordingHost();
    const guest = contents('webview');

    routeGuestPopups(guest.source, host, () => null);

    expect(guest.open(SIGN_IN)).toEqual({ action: 'deny' });
    expect(tabs).toEqual([[7, SIGN_IN.url]]);
    expect(windows).toEqual([]);
  });
});
