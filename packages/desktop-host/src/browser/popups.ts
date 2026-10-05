/**
 * Where a new window from a page in the pane goes: into the pane, as a tab.
 *
 * Electron gives every `<webview>` the default window-open behaviour — a bare
 * window of its own — unless something says otherwise. That window sat beside
 * the app, outside the pane the user watches, and was invisible to the agent
 * whose click opened it. Main calls this for every web contents it creates; only
 * the pane's views (type `webview`) are touched.
 */

export interface PopupSource {
  readonly id: number;
  getType(): string;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void;
}

export function routeGuestPopups(
  contents: PopupSource,
  host: { openFromPage(openerWebContentsId: number, url: string): void },
): void {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => {
    // Only a web page becomes a tab; anything else opens nowhere.
    if (/^https?:\/\//i.test(url) || url === 'about:blank') host.openFromPage(contents.id, url);
    return { action: 'deny' };
  });
}
