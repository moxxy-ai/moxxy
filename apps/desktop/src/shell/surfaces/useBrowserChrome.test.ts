import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { FILE_INSERT_EVENT } from '@/shell/WorkspaceFiles';
import { useBrowserChrome } from './useBrowserChrome.js';

/**
 * The chrome around the page: what the address bar says, which tab the buttons
 * act on, and whether the agent's view of the page is open. Pulled out of the
 * pane so the pane renders and nothing else — and so this behaviour can be
 * driven without a `<webview>`, which a test has no way to create.
 */
const noop = async (): Promise<void> => undefined;

describe('useBrowserChrome — the address bar', () => {
  it('follows the page while the user is not typing', () => {
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate: noop }));

    act(() => result.current.onViewState('t1', 'https://example.com/'));

    expect(result.current.address).toBe('https://example.com/');
  });

  it('stops following the moment the user types, so it cannot overwrite them', () => {
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate: noop }));

    act(() => result.current.setAddress('canva.com'));
    act(() => result.current.onViewState('t1', 'https://example.com/'));

    expect(result.current.address).toBe('canva.com');
  });

  it('navigates what was typed and hands the bar back to the page', async () => {
    const navigate = vi.fn(async () => undefined);
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate }));
    act(() => result.current.setAddress('canva.com'));

    await act(async () => result.current.submitAddress());

    expect(navigate).toHaveBeenCalledWith('https://canva.com', 't1');
    act(() => result.current.onViewState('t1', 'https://canva.com/'));
    expect(result.current.address).toBe('https://canva.com/');
  });

  it('does not navigate to nothing', async () => {
    const navigate = vi.fn(async () => undefined);
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate }));

    act(() => result.current.setAddress('   '));
    await act(async () => result.current.submitAddress());

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('useBrowserChrome — which tab the buttons act on', () => {
  it("prefers main's active tab over whatever this pane last saw", () => {
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't2', navigate: noop }));

    act(() => result.current.onViewState('t1', 'https://example.com/'));

    expect(result.current.targetTab()).toBe('t2');
  });

  it('falls back to the view in front before anything is adopted', () => {
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: null, navigate: noop }));

    act(() => result.current.onViewState('t1', 'https://example.com/'));

    expect(result.current.targetTab()).toBe('t1');
  });
});


/**
 * The button in the toolbar takes a picture of the page and hands it to the
 * agent — the same journey a pasted screenshot makes, so it arrives as an
 * ordinary attachment chip rather than as some second kind of thing.
 */
function installApi(opts: { captureFails?: boolean } = {}): {
  calls: Array<{ channel: string; args: unknown }>;
} {
  const calls: Array<{ channel: string; args: unknown }> = [];
  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      calls.push({ channel, args });
      if (channel === 'browser.capture') {
        return opts.captureFails
          ? Promise.reject(new Error('the page did not return an image'))
          : Promise.resolve({ tabId: 't1', mediaType: 'image/png', base64: 'AAAA' });
      }
      if (channel === 'session.saveImageAttachment') {
        return Promise.resolve({ path: '/tmp/shot.png', name: 'browser-example.com.png' });
      }
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
  return { calls };
}

afterEach(() => __setApiOverride(null as never));

describe('useBrowserChrome — sending a screenshot to the agent', () => {
  it('captures the tab in front and offers it as an attachment', async () => {
    const { calls } = installApi();
    const attached: Array<{ name: string; absPath: string }> = [];
    const onInsert = (ev: Event): void => {
      attached.push((ev as CustomEvent<{ name: string; absPath: string }>).detail);
    };
    window.addEventListener(FILE_INSERT_EVENT, onInsert);
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate: noop }));
    act(() => result.current.onViewState('t1', 'https://example.com/'));

    await act(async () => {
      await result.current.captureToAgent();
    });

    window.removeEventListener(FILE_INSERT_EVENT, onInsert);
    expect(calls.find((c) => c.channel === 'browser.capture')?.args).toEqual({ tabId: 't1' });
    expect(calls.find((c) => c.channel === 'session.saveImageAttachment')?.args).toMatchObject({
      dataBase64: 'AAAA',
      mediaType: 'image/png',
    });
    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({ name: 'browser-example.com.png', absPath: '/tmp/shot.png' });
  });

  it('names the file after the page, so a row of chips stays tellable apart', async () => {
    const { calls } = installApi();
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate: noop }));
    act(() => result.current.onViewState('t1', 'https://www.canva.com/design/abc'));

    await act(async () => {
      await result.current.captureToAgent();
    });

    expect(calls.find((c) => c.channel === 'session.saveImageAttachment')?.args).toMatchObject({
      name: 'browser-canva.com.png',
    });
  });

  it('says what went wrong instead of failing silently', async () => {
    installApi({ captureFails: true });
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate: noop }));

    await act(async () => {
      await result.current.captureToAgent();
    });

    await waitFor(() => expect(result.current.captureError).toContain('did not return an image'));
  });
});

describe('useBrowserChrome — cropping the screenshot', () => {
  /**
   * The pane used to let you drag a box over the streamed JPEG and send that
   * region; rewriting it around a real Chromium view lost the feature. The host
   * has taken a `clip` all along, so this is the missing half: a mode to draw
   * the rectangle in, and the rectangle reaching the capture.
   */
  it('sends the whole view when no rectangle was drawn', async () => {
    const { calls } = installApi();
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate: noop }));
    act(() => result.current.onViewState('t1', 'https://example.com/'));

    await act(async () => {
      await result.current.captureToAgent();
    });

    expect(calls.find((c) => c.channel === 'browser.capture')?.args).toEqual({ tabId: 't1' });
  });

  it('sends the rectangle when one was', async () => {
    const { calls } = installApi();
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate: noop }));
    act(() => result.current.onViewState('t1', 'https://example.com/'));

    await act(async () => {
      await result.current.captureToAgent({ x: 10, y: 20, width: 100, height: 50 });
    });

    expect(calls.find((c) => c.channel === 'browser.capture')?.args).toEqual({
      tabId: 't1',
      clip: { x: 10, y: 20, width: 100, height: 50 },
    });
  });

  it('is not in selection mode until asked', () => {
    installApi();
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate: noop }));

    expect(result.current.picking).toBe(false);
  });

  it('leaves selection mode once a rectangle has been taken', async () => {
    installApi();
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate: noop }));
    act(() => result.current.startPicking());
    expect(result.current.picking).toBe(true);

    await act(async () => {
      await result.current.captureToAgent({ x: 0, y: 0, width: 10, height: 10 });
    });

    expect(result.current.picking).toBe(false);
  });

  it('leaves it on a cancel too, without sending anything', async () => {
    const { calls } = installApi();
    const { result } = renderHook(() => useBrowserChrome({ activeTabId: 't1', navigate: noop }));
    act(() => result.current.startPicking());

    await act(async () => {
      await result.current.captureToAgent(null);
    });

    expect(result.current.picking).toBe(false);
    expect(calls.some((c) => c.channel === 'browser.capture')).toBe(false);
  });
});
