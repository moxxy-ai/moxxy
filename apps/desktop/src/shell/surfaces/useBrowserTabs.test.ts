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
    expect(out).toContain('duckduckgo.com');
    expect(out).toContain('plakat');
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
