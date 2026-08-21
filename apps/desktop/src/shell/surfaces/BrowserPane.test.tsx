import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { __setApiOverride } from '@moxxy/client-core';
import { FILE_INSERT_EVENT } from '@/shell/WorkspaceFiles';
import { BrowserPane } from './BrowserPane';

/**
 * The pane's chrome. What matters here is that the controls a person needs are
 * present and reach the right command — the page itself is a Chromium view no
 * test environment can create, and everything about it is covered on the main
 * side.
 */
const TABS = [
  { tabId: 't1', url: 'https://duckduckgo.com/', title: 'DuckDuckGo', active: true },
  { tabId: 't2', url: 'https://example.com/', title: 'Example Domain', active: false },
];

function installApi(): { calls: Array<{ channel: string; args: unknown }> } {
  const calls: Array<{ channel: string; args: unknown }> = [];
  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      calls.push({ channel, args });
      if (channel === 'browser.listTabs') return Promise.resolve({ tabs: TABS, activeTabId: 't1' });
      if (channel === 'browser.capture')
        return Promise.resolve({ tabId: 't1', mediaType: 'image/png', base64: 'AAAA' });
      if (channel === 'session.saveImageAttachment')
        return Promise.resolve({ path: '/tmp/shot.png', name: 'browser-duckduckgo.com.png' });
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

describe('BrowserPane', () => {
  it('names every open tab and says which one is in front', async () => {
    installApi();
    render(<BrowserPane workspaceId="w1" />);

    const tabs = await screen.findAllByRole('tab');

    expect(tabs.map((t) => t.textContent)).toEqual(['DuckDuckGo', 'Example Domain']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('offers a way to close each tab, named so it is unambiguous', async () => {
    const { calls } = installApi();
    render(<BrowserPane workspaceId="w1" />);
    const close = await screen.findByLabelText('Close Example Domain');

    await userEvent.click(close);

    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'browser.releaseTab' && (c.args as { tabId: string }).tabId === 't2')).toBe(
        true,
      ),
    );
  });

  it('switches tabs through main rather than guessing locally', async () => {
    const { calls } = installApi();
    render(<BrowserPane workspaceId="w1" />);
    const tabs = await screen.findAllByRole('tab');

    await userEvent.click(tabs[1]!);

    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'browser.selectTab' && (c.args as { tabId: string }).tabId === 't2')).toBe(
        true,
      ),
    );
  });

  it('hands a picture of the page to the agent, not a dump of what it reads', async () => {
    // The pane is for the person. How the agent perceives a page is between the
    // agent and the host, and putting it on screen only invited the question of
    // what to do with it.
    installApi();
    const attached: string[] = [];
    const onInsert = (ev: Event): void => {
      attached.push((ev as CustomEvent<{ name: string }>).detail.name);
    };
    window.addEventListener(FILE_INSERT_EVENT, onInsert);
    render(<BrowserPane workspaceId="w1" />);

    await userEvent.click(await screen.findByLabelText('Screenshot to agent'));

    await waitFor(() => expect(attached).toEqual(['browser-duckduckgo.com.png']));
    window.removeEventListener(FILE_INSERT_EVENT, onInsert);
    expect(screen.queryByLabelText('What the agent sees')).toBeNull();
  });

  it('says what to do instead of rendering a browser with no workspace', () => {
    installApi();
    render(<BrowserPane workspaceId={null} />);

    expect(screen.getByText(/Open a workspace/)).toBeTruthy();
    expect(screen.queryByLabelText('Address')).toBeNull();
  });
});

describe('BrowserPane — the hand-off banner', () => {
  /**
   * Seen live: the agent asked twice about a cookie banner that was nowhere on
   * the user's screen. The pane now fronts the tab and main scrolls to the
   * control — but when neither can put it in view, saying so is the only honest
   * thing left. "Press Done" on an invisible control is how a hand-off becomes
   * a loop.
   */
  function renderWithHandoff(onScreen: boolean): void {
    let fire: ((req: unknown) => void) | null = null;
    __setApiOverride({
      invoke: ((channel: string) => {
        if (channel === 'browser.listTabs') return Promise.resolve({ tabs: TABS, activeTabId: 't1' });
        return Promise.resolve(undefined);
      }) as never,
      subscribe: ((event: string, cb: unknown) => {
        if (event === 'browser.handoffRequested') fire = cb as typeof fire;
        return () => undefined;
      }) as never,
    } as never);
    render(<BrowserPane workspaceId="w1" />);
    act(() => fire?.({ requestId: 'h1', tabId: 't1', reason: 'zaakceptuj cookies', onScreen }));
  }

  it('tells the person to press it when it is in front of them', () => {
    renderWithHandoff(true);

    expect(screen.getByText(/do what it asks/i)).toBeTruthy();
    expect(screen.queryByText(/not in view/i)).toBeNull();
  });

  it('tells them where to look when it is not', () => {
    renderWithHandoff(false);

    expect(screen.getByText(/not in view/i)).toBeTruthy();
  });
});
