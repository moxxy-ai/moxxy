import { describe, expect, it } from 'vitest';
import { routeGuestPopups } from './popups.js';

/**
 * A page in the pane asking for a new window — `target=_blank`, `window.open`.
 *
 * Left to Electron it became a bare window of its own, beside the app and
 * outside the pane: the user saw something pop up somewhere else, and the agent,
 * whose click had opened it, saw nothing happen at all.
 */

type Handler = (details: { url: string }) => { action: 'allow' | 'deny' };

function contents(type: string, id = 7) {
  let handler: Handler | null = null;
  return {
    id,
    getType: () => type,
    setWindowOpenHandler: (fn: Handler) => {
      handler = fn;
    },
    open: (url: string) => (handler ? handler({ url }) : null),
  };
}

describe('routeGuestPopups', () => {
  it('turns a new window from a page in the pane into a tab, and opens no window', () => {
    const opened: Array<[number, string]> = [];
    const guest = contents('webview');

    routeGuestPopups(guest, { openFromPage: (id, url) => opened.push([id, url]) });

    expect(guest.open('https://example.org/')).toEqual({ action: 'deny' });
    expect(opened).toEqual([[7, 'https://example.org/']]);
  });

  it('leaves the app’s own windows to their own rules', () => {
    const opened: unknown[] = [];
    const window = contents('window');

    routeGuestPopups(window, { openFromPage: (...args) => opened.push(args) });

    expect(window.open('https://example.org/')).toBeNull();
    expect(opened).toEqual([]);
  });

  it('opens nothing for an address that is not a web page', () => {
    const opened: unknown[] = [];
    const guest = contents('webview');

    routeGuestPopups(guest, { openFromPage: (...args) => opened.push(args) });

    expect(guest.open('file:///etc/passwd')).toEqual({ action: 'deny' });
    expect(guest.open('javascript:alert(1)')).toEqual({ action: 'deny' });
    expect(opened).toEqual([]);
  });
});
