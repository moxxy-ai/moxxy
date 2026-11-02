/**
 * `browser.showUrl`: a chat link opened in the Moxxy browser. The browser pane
 * lives in the main window only, so main brings that window forward and asks
 * it to open the address; the mini chat, which has no pane, asks the same way.
 */

import { assertSafeExternalUrl } from '../security';
import { handle, IpcError } from './shared';

/** `show` brings the main window forward and sends it the address; omitted when there is none. */
export function registerBrowserLinkHandlers(show?: (url: string) => void): void {
  handle('browser.showUrl', async ({ url }) => {
    assertSafeExternalUrl(url);
    if (!show) throw new IpcError('not-supported', 'the Moxxy browser is unavailable');
    show(url);
  });
}
