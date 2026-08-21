import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { HOME_URL, normalizeAddress, useBrowserTabs } from './useBrowserTabs.js';

/**
 * The address bar accepts what people actually type. Getting this wrong is
 * cheap to do and annoying to live with: a bare host that turns into a search,
 * or a search phrase that turns into a DNS failure.
 */
describe('normalizeAddress', () => {
  it('passes an explicit URL through untouched', () => {
    expect(normalizeAddress('https://canva.com/design')).toBe('https://canva.com/design');
    expect(normalizeAddress('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('assumes https for a bare host', () => {
    expect(normalizeAddress('canva.com')).toBe('https://canva.com');
    expect(normalizeAddress('sklep.example.co.uk/oferta')).toBe('https://sklep.example.co.uk/oferta');
  });

  it('treats a phrase as a search, not a hostname', () => {
    const out = normalizeAddress('plakat na instagram');
    expect(out).toContain('google.com/search');
    expect(out).toContain('plakat');
  });

  it('escapes what was typed instead of pasting it into the query', () => {
    // A phrase with an ampersand would otherwise become two query parameters.
    expect(normalizeAddress('koty & psy')).toContain(encodeURIComponent('koty & psy'));
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeAddress('  canva.com  ')).toBe('https://canva.com');
  });

  it('returns null for nothing to navigate to', () => {
    expect(normalizeAddress('')).toBeNull();
    expect(normalizeAddress('   ')).toBeNull();
  });
});

/**
 * A browser you cannot close a tab in is not a browser. The pane owns the
 * `<webview>` elements, so closing is the renderer dropping the element and
 * main noticing — not a command main could carry out on its own.
 */
function installApi(): { calls: Array<{ channel: string; args: unknown }> } {
  const calls: Array<{ channel: string; args: unknown }> = [];
  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      calls.push({ channel, args });
      if (channel === 'browser.listTabs') return Promise.resolve({ tabs: [], activeTabId: null });
      if (channel === 'browser.registerTab') return Promise.resolve({ tabId: 't1' });
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
  return { calls };
}

afterEach(() => {
  cleanup();
  __setApiOverride(null as never);
});

describe('closing a tab', () => {
  it('drops the pane that hosts it, which is what tears the view down', async () => {
    installApi();
    const { result } = renderHook(() => useBrowserTabs());
    act(() => result.current.openPane('https://example.com'));
    const second = result.current.panes[1]!;
    act(() => result.current.noteAdoption(second.key, 't2'));

    await act(async () => {
      await result.current.closeTab('t2');
    });

    expect(result.current.panes.map((p) => p.key)).not.toContain(second.key);
    expect(result.current.panes).toHaveLength(1);
  });

  it('never leaves the browser with no tab at all', async () => {
    installApi();
    const { result } = renderHook(() => useBrowserTabs());
    const only = result.current.panes[0]!;
    act(() => result.current.noteAdoption(only.key, 't1'));

    await act(async () => {
      await result.current.closeTab('t1');
    });

    await waitFor(() => expect(result.current.panes).toHaveLength(1));
    expect(result.current.panes[0]?.key).not.toBe(only.key);
    expect(result.current.panes[0]?.initialUrl).toBe(HOME_URL);
  });

  it('releases a tab this pane never hosted rather than doing nothing', async () => {
    const { calls } = installApi();
    const { result } = renderHook(() => useBrowserTabs());

    await act(async () => {
      await result.current.closeTab('t99');
    });

    expect(calls.some((c) => c.channel === 'browser.releaseTab')).toBe(true);
  });
});

describe('focusing a view so a key can land on it', () => {
  /**
   * A key only reaches the page when the `<webview>` element has focus in this
   * window's DOM, and answering an approval prompt takes it away — answering
   * means clicking in the app. Main cannot fix that from its side: the guest is
   * a child of the embedder, so the element has to be focused here.
   */
  function apiWithFocusEvent(): {
    calls: Array<{ channel: string; args: unknown }>;
    fire: (req: { requestId: string; tabId: string }) => void;
    askHuman: (req: { requestId: string; tabId: string; reason: string }) => void;
  } {
    const calls: Array<{ channel: string; args: unknown }> = [];
    let handler: ((req: { requestId: string; tabId: string }) => void) | null = null;
    let handoffHandler: ((req: { requestId: string; tabId: string; reason: string }) => void) | null = null;
    __setApiOverride({
      invoke: ((channel: string, args: unknown) => {
        calls.push({ channel, args });
        if (channel === 'browser.listTabs') return Promise.resolve({ tabs: [], activeTabId: null });
        return Promise.resolve(undefined);
      }) as never,
      subscribe: ((event: string, cb: unknown) => {
        if (event === 'browser.focusTab') handler = cb as typeof handler;
        if (event === 'browser.handoffRequested') handoffHandler = cb as typeof handoffHandler;
        return () => undefined;
      }) as never,
    } as never);
    return {
      calls,
      fire: (req) => handler?.(req),
      askHuman: (req: { requestId: string; tabId: string; reason: string }) => handoffHandler?.(req),
    };
  }

  it('brings the tab forward, focuses its view, and says when it has', async () => {
    // A hidden view cannot take focus — measured against a real page: the same
    // keys do nothing behind another tab and work the moment it is in front.
    const { calls, fire } = apiWithFocusEvent();
    const { result } = renderHook(() => useBrowserTabs());
    let focused = 0;
    act(() => result.current.registerView('t2', () => focused++));

    await act(async () => {
      fire({ requestId: 'f1', tabId: 't2' });
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(calls.some((c) => c.channel === 'browser.selectTab' && (c.args as { tabId: string }).tabId === 't2')).toBe(true);
    expect(focused).toBe(1);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'browser.confirmFocus' && (c.args as { requestId: string }).requestId === 'f1')).toBe(true),
    );
  });

  it('still answers for a view it does not have, so nothing waits on it', async () => {
    const { calls, fire } = apiWithFocusEvent();
    renderHook(() => useBrowserTabs());

    await act(async () => {
      fire({ requestId: 'f2', tabId: 'tNieMa' });
      await new Promise((r) => setTimeout(r, 60));
    });

    await waitFor(() => expect(calls.some((c) => c.channel === 'browser.confirmFocus')).toBe(true));
  });

  it('forgets a view whose tab has gone', async () => {
    const { fire } = apiWithFocusEvent();
    const { result } = renderHook(() => useBrowserTabs());
    let focused = 0;
    act(() => result.current.registerView('t2', () => focused++));
    act(() => result.current.registerView('t2', null));

    await act(async () => {
      fire({ requestId: 'f3', tabId: 't2' });
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(focused).toBe(0);
  });

  /**
   * Asking is the easy half. Seen live: the pane sat on one tab while the
   * consent banner it was asking about was on another, so the person was told
   * to press something that was not in front of them — twice, because pressing
   * Done without doing anything leaves the wall exactly where it was.
   */
  it('brings the tab a hand-off is about to the front', async () => {
    const { calls, askHuman } = apiWithFocusEvent();
    const { result } = renderHook(() => useBrowserTabs());

    await act(async () => {
      askHuman({ requestId: 'h1', tabId: 't2', reason: 'zaakceptuj cookies' });
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(calls.some((c) => c.channel === 'browser.selectTab' && (c.args as { tabId: string }).tabId === 't2')).toBe(
      true,
    );
    expect(result.current.handoff?.reason).toBe('zaakceptuj cookies');
  });
});

