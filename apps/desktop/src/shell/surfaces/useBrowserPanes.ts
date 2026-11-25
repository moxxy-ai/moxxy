import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { hasBrowserRequests, onBrowserRequest, takeBrowserRequests } from './browser-link-requests';
import type { BrowserTabInfo } from '@moxxy/desktop-ipc-contract';

/**
 * Where a fresh tab starts, and what a typed phrase is searched with.
 *
 * On a profile that has never been there, Google answers with the EU consent
 * wall rather than results. That is not a wall the agent may clear — the choice
 * is the user's — so the snapshot flags it and the agent hands over. The
 * partition is persistent, so it is asked once and then never again.
 */
export const HOME_URL = 'https://www.google.com';

export function useBrowserPanes() {
  const adoptedByPane = useRef(new Map<string, string>());
  // One entry per <webview> this pane renders. The first is the user's home
  // tab; the rest arrive because the agent asked for them — main cannot create
  // the element itself, so it sends `browser.openTab` and we oblige. A pane
  // opened for a chat link starts at the link alone: with a home tab beside
  // it, whichever page loaded last would end up in front.
  const [panes, setPanes] = useState<ReadonlyArray<{ key: string; initialUrl: string; requestId?: string }>>(() =>
    hasBrowserRequests() ? [] : [{ key: 'home', initialUrl: HOME_URL }],
  );
  const paneSeq = useRef(0);

  const openPane = useCallback((url: string) => {
    const pane = { key: `p${++paneSeq.current}`, initialUrl: url };
    setPanes((prev) => [...prev, pane]);
  }, []);

  // A chat link asked for an address in the Moxxy browser: each becomes a new
  // tab. Before paint, so a pane started without its home tab is never drawn
  // empty; and should another pane have taken the links first, it gets one.
  useLayoutEffect(() => {
    const take = (): void => takeBrowserRequests().forEach(openPane);
    take();
    setPanes((prev) => (prev.length > 0 ? prev : [{ key: 'home', initialUrl: HOME_URL }]));
    return onBrowserRequest(take);
  }, [openPane]);

  const closeHostedTab = useCallback((tabId: string): boolean => {
    const key = [...adoptedByPane.current].find(([, id]) => id === tabId)?.[0];
    if (key === undefined) return false;
    adoptedByPane.current.delete(key);

    // React can replay this update after a pending open. Capture both keys once.
    const home = { key: `p${++paneSeq.current}`, initialUrl: HOME_URL };
    setPanes((prev) => {
      const left = prev.filter((pane) => pane.key !== key);
      return left.length ? left : [home];
    });
    return true;
  }, []);

  const openAgentPane = useCallback((requestId: string, url: string) => {
    setPanes((prev) => [...prev, { key: `agent-${requestId}`, initialUrl: url, requestId }]);
  }, []);

  const reconcile = useCallback((next: ReadonlyArray<BrowserTabInfo>) => {
    const live = new Set(next.map((t) => t.tabId));
    // Only compare registrations known when this snapshot arrived. A webview
    // adopted before React renders the update can be newer than the snapshot.
    const removed = new Set<string>();
    for (const [key, tabId] of adoptedByPane.current) {
      if (live.has(tabId)) continue;
      removed.add(key);
      adoptedByPane.current.delete(key);
    }
    if (removed.size) setPanes((prev) => prev.filter((pane) => !removed.has(pane.key)));
  }, []);

  return {
    panes, openPane, closeHostedTab, openAgentPane, reconcile,
    noteAdoption: (key: string, tabId: string) => adoptedByPane.current.set(key, tabId),
  };
}
