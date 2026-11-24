/**
 * Where a new window from a page in the pane goes.
 *
 * Electron gives every `<webview>` the default window-open behaviour — a bare
 * window of its own — unless something says otherwise. That window sat beside
 * the app, outside the pane the user watches, and was invisible to the agent
 * whose click opened it. So a link that asks for a new tab (`target=_blank`,
 * a plain `window.open(url)`, a shift-click) becomes a tab in the pane.
 *
 * A popup is the exception, and a real popup it stays. A sign-in through
 * Google, Apple or Microsoft opens a small window — `window.open(url, name,
 * 'width=…,height=…')` — and the page waits for it to hand the result back
 * through `window.opener` and close itself. A tab in the pane is a separate
 * page with no opener: `window.open` returned null, the site said "popup
 * blocked" at once, and the person signed in inside a tab that led nowhere
 * (MOXXY-5, seen live on ElevenLabs as "Unable to sign in"). As a popup over
 * the app window it works the way it does in Chrome: it closes when it is done
 * and the page that asked is still the tab in front, signed in.
 *
 * Main calls this for every web contents it creates; only the pane's views
 * (type `webview`) are touched, and through them the popups they open.
 */

export interface PopupRequest {
  readonly url: string;
  /** How Chromium wants it opened; `new-window` is a popup or a shift-click. */
  readonly disposition: string;
  /** The third argument of `window.open`; empty for a link. */
  readonly features: string;
}

/**
 * The slice of a BrowserWindow's options this decides; main's Electron types
 * are the real contract. `W` is the window type — Electron's BrowserWindow in
 * the app, a plain object in a test.
 */
export interface PopupWindowOptions<W> {
  readonly parent: W;
  readonly autoHideMenuBar: true;
  readonly webPreferences: {
    readonly contextIsolation: true;
    readonly sandbox: true;
    readonly nodeIntegration: false;
    readonly nodeIntegrationInWorker: false;
    readonly nodeIntegrationInSubFrames: false;
    readonly webSecurity: true;
    readonly allowRunningInsecureContent: false;
    readonly webviewTag: false;
    readonly plugins: false;
    readonly experimentalFeatures: false;
    readonly preload: undefined;
  };
}

export type PopupDecision<W> =
  | { action: 'deny' }
  | { action: 'allow'; overrideBrowserWindowOptions: PopupWindowOptions<W> };

/** A popup window, as far as this needs one: the web contents it shows. */
export interface PopupWindow<W> {
  readonly webContents: PopupSource<W>;
}

export interface PopupSource<W> {
  readonly id: number;
  getType(): string;
  setWindowOpenHandler(handler: (details: PopupRequest) => PopupDecision<W>): void;
  on(event: 'did-create-window', listener: (window: W & PopupWindow<W>) => void): unknown;
}

export interface PopupHost {
  /** Open the address as a tab in the pane, counted against the page that asked. */
  openFromPage(openerWebContentsId: number, url: string): void;
  /** Note a popup the page opened over the app, so the action that opened it can say so. */
  openedWindowFromPage?(openerWebContentsId: number, url: string): void;
}

/**
 * @param windowOf the window a popup from this pane view sits over — the app
 *   window hosting it. Null leaves the popup a tab: a parentless window would
 *   be exactly the stray window beside the app this exists to prevent.
 */
export function routeGuestPopups<W>(
  contents: PopupSource<W>,
  host: PopupHost,
  windowOf: (contents: PopupSource<W>) => W | null,
): void {
  if (contents.getType() !== 'webview') return;
  route(contents, host, () => windowOf(contents));
}

function route<W>(contents: PopupSource<W>, host: PopupHost, parentOf: () => W | null): void {
  contents.setWindowOpenHandler((details) => {
    // Only a web page opens at all; anything else opens nowhere.
    if (!isWebPage(details.url)) return { action: 'deny' };
    const parent = isPopup(details) ? parentOf() : null;
    if (parent) {
      host.openedWindowFromPage?.(contents.id, details.url);
      return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions(parent) };
    }
    host.openFromPage(contents.id, details.url);
    return { action: 'deny' };
  });
  // The popup's own new windows follow the same rules, with the popup as their parent.
  contents.on('did-create-window', (window) => route(window.webContents, host, () => window));
}

function isWebPage(url: string): boolean {
  return /^https?:\/\//i.test(url) || url === 'about:blank';
}

/**
 * A popup is a new window the page sized or shaped itself and kept its opener
 * for. A shift-click is `new-window` too but asks for nothing; a page that
 * gives up its opener has nothing to hand back, so a tab serves it as well.
 */
function isPopup({ disposition, features }: PopupRequest): boolean {
  if (disposition !== 'new-window' || !features.trim()) return false;
  return !/(^|,)\s*no(opener|referrer)\s*(=\s*(yes|1|true))?\s*(,|$)/i.test(features);
}

/**
 * Electron already gives a popup its opener's security preferences; these say
 * so outright, so a popup can never come out with more than the pane's views
 * get (see hardenWebviewPreferences). The session is not named: a popup must
 * share its opener's, or there is no opener to hand anything back to.
 */
function popupWindowOptions<W>(parent: W): PopupWindowOptions<W> {
  return {
    parent,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      plugins: false,
      experimentalFeatures: false,
      preload: undefined,
    },
  };
}
