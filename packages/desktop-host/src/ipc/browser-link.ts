/**
 * `browser.showUrl`: a chat link opened in the Moxxy browser. The browser pane
 * lives in the main window only, and only that window offers the action (the
 * Mini Chat leaves it out), so main just hands the address to its renderer.
 */

import { assertSafeExternalUrl } from '../security';
import { handle, IpcError } from './shared';

/** `show` sends the address to the main window, false when it is closed; omitted when there is none. */
export function registerBrowserLinkHandlers(show?: (url: string) => boolean): void {
  handle('browser.showUrl', async ({ url }) => {
    assertSafeExternalUrl(url);
    if (!show?.(url)) throw new IpcError('not-supported', 'the Moxxy browser is unavailable');
  });
}
