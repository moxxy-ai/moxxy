/**
 * The agent's browser, hosted in the main process.
 *
 * Unlike the `surface.*` relay next door, nothing here goes to the runner:
 * the page lives in a Chromium view THIS process owns, so the pane renders it
 * by hosting it rather than by receiving pictures of it. That is the whole
 * reason the pane no longer costs anything to keep open.
 *
 * The renderer's only privilege is to attach a `<webview>` and say "this is
 * mine" — main hardens the view's preferences at attach time (see
 * `security.ts`) and owns everything after.
 */

import type { BrowserHost } from '../browser/host';
import { handle } from './shared';

export function registerBrowserHandlers(host: BrowserHost): void {
  handle('browser.registerTab', async ({ webContentsId, requestId }) => ({
    tabId: host.register(webContentsId, requestId),
  }));

  handle('browser.releaseTab', async ({ tabId }) => {
    host.unregister(tabId);
  });

  handle('browser.listTabs', async () => ({
    tabs: host.list(),
    activeTabId: host.activeId,
  }));

  handle('browser.selectTab', async ({ tabId }) => {
    host.select(tabId);
  });

  handle('browser.navigate', async ({ url, tabId }) => {
    const reply = await host.goto(url, tabId);
    if (!reply.ok) throw new Error(reply.error?.message ?? 'navigation failed');
    return reply.result as { url: string; tabId: string };
  });

  handle('browser.history', async ({ action, tabId }) => {
    const reply = await host.history(action, tabId);
    if (!reply.ok) throw new Error(reply.error?.message ?? 'navigation failed');
  });

  handle('browser.resolveHandoff', async ({ requestId, completed }) => {
    host.resolveHandoff(requestId, completed);
  });

  handle('browser.capture', async ({ tabId }) => {
    const reply = await host.capture(tabId ? { tabId } : {});
    if (!reply.ok) throw new Error(reply.error?.message ?? 'capture failed');
    return reply.result as { tabId: string; mediaType: string; base64: string };
  });
}
