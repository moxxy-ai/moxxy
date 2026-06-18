/**
 * Unit tests for the `moxxy://` deep-link transport (parseDeepLink +
 * DeepLinkRouter). Extracting these from index.ts lets the URL parsing + the
 * cold-start buffer be tested without booting Electron.
 */
import { describe, expect, it, vi } from 'vitest';

// @moxxy/desktop-host is a heavy main-process bundle; stub the one symbol the
// router uses (sendEvent) so the buffer logic is exercised in isolation.
const sendEvent = vi.fn();
vi.mock('@moxxy/desktop-host', () => ({ sendEvent: (...a: unknown[]) => sendEvent(...a) }));

import { DeepLinkRouter, parseDeepLink } from './deep-link.js';

describe('parseDeepLink', () => {
  it('parses a well-formed moxxy:// URL into host/path/params', () => {
    expect(parseDeepLink('moxxy://pair/connect?token=abc&v=2')).toEqual({
      url: 'moxxy://pair/connect?token=abc&v=2',
      host: 'pair',
      path: '/connect',
      params: { token: 'abc', v: '2' },
    });
  });

  it('defaults the path to / when absent', () => {
    expect(parseDeepLink('moxxy://home')).toEqual({
      url: 'moxxy://home',
      host: 'home',
      path: '/',
      params: {},
    });
  });

  it('returns null for a non-moxxy scheme', () => {
    expect(parseDeepLink('https://example.com/x')).toBeNull();
    expect(parseDeepLink('http://moxxy/x')).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(parseDeepLink('not a url')).toBeNull();
    expect(parseDeepLink('')).toBeNull();
  });
});

describe('DeepLinkRouter', () => {
  function fakeWindow() {
    return { isDestroyed: () => false } as unknown as import('electron').BrowserWindow;
  }

  it('buffers links until the renderer drains, then replays them in order', () => {
    sendEvent.mockClear();
    const focus = vi.fn();
    const win = fakeWindow();
    const router = new DeepLinkRouter(() => win, focus);

    router.handle('moxxy://a');
    router.handle('moxxy://b');
    // Nothing pushed live yet (renderer not ready), but each focuses the window.
    expect(sendEvent).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(2);

    const drained = router.drain();
    expect(drained.map((p) => p.host)).toEqual(['a', 'b']);
    // A second drain returns nothing — the buffer was emptied.
    expect(router.drain()).toEqual([]);
  });

  it('pushes live once ready, and re-buffers after markLoading', () => {
    sendEvent.mockClear();
    const win = fakeWindow();
    const router = new DeepLinkRouter(() => win, vi.fn());

    router.drain(); // marks ready
    router.handle('moxxy://live');
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenCalledWith(win, 'deepLink:received', expect.objectContaining({ host: 'live' }));

    // A (re)load re-buffers until the next drain.
    router.markLoading();
    router.handle('moxxy://after-reload');
    expect(sendEvent).toHaveBeenCalledTimes(1); // not pushed live
    expect(router.drain().map((p) => p.host)).toEqual(['after-reload']);
  });

  it('ignores a non-moxxy URL (no focus, no buffer)', () => {
    sendEvent.mockClear();
    const focus = vi.fn();
    const router = new DeepLinkRouter(() => fakeWindow(), focus);
    router.handle('https://example.com');
    expect(focus).not.toHaveBeenCalled();
    expect(router.drain()).toEqual([]);
  });

  it('buffers when the window is destroyed even if ready', () => {
    sendEvent.mockClear();
    const destroyed = { isDestroyed: () => true } as unknown as import('electron').BrowserWindow;
    const router = new DeepLinkRouter(() => destroyed, vi.fn());
    router.drain(); // ready
    router.handle('moxxy://x');
    expect(sendEvent).not.toHaveBeenCalled();
    expect(router.drain().map((p) => p.host)).toEqual(['x']);
  });
});
