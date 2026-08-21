import { useCallback, useEffect, useRef, useState } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import type { BrowserTabInfo } from '@moxxy/desktop-ipc-contract';

/**
 * Everything the browser pane knows how to do, with none of the markup.
 *
 * The pane itself renders a `<webview>` — a real Chromium view the window
 * composites — so there is no frame stream to manage here and nothing to
 * throttle. What this hook owns is the part that is genuinely stateful: which
 * tabs exist, which one is in front, and the hand-off where the renderer tells
 * main "this view is yours now".
 *
 * Kept DOM-free apart from the element ref so it can be driven directly in a
 * test, and so the component stays a pure function of what it returns.
 */

export interface BrowserTabsApi {
  readonly tabs: ReadonlyArray<BrowserTabInfo>;
  readonly activeTabId: string | null;
  readonly error: string | null;
  /** Adopt a freshly attached view. Call once its webContents id is known. */
  readonly adopt: (webContentsId: number, requestId?: string) => Promise<string | null>;
  /** Views this pane is showing, one per tab. */
  readonly panes: ReadonlyArray<{ readonly key: string; readonly initialUrl: string; readonly requestId?: string }>;
  /** Add a pane the user asked for. */
  readonly openPane: (url: string) => void;
  /** Record which tab a pane became, so a closed tab can be pruned. */
  readonly noteAdoption: (paneKey: string, tabId: string) => void;
  /**
   * Offer a way to give this tab's view keyboard focus, or `null` to withdraw
   * it. Main asks for this before sending a key: the element has to be focused
   * in THIS window's DOM for the key to reach the page, and only the renderer
   * can do that.
   */
  readonly registerView: (tabId: string, focus: (() => void) | null) => void;
  /** Release a view whose element is going away. */
  readonly release: (tabId: string) => Promise<void>;
  /** Close a tab: drop its view, and never leave the browser with none. */
  readonly closeTab: (tabId: string) => Promise<void>;
  readonly select: (tabId: string) => Promise<void>;
  readonly navigate: (url: string, tabId?: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
  /** Browser history, driven through main so the agent and the buttons agree. */
  readonly history: (action: 'back' | 'forward' | 'reload', tabId?: string) => Promise<void>;
  /** Outstanding request for the person at the keyboard, if any. */
  readonly handoff: { readonly requestId: string; readonly tabId: string; readonly reason: string } | null;
  /** Answer the hand-off: done, or skipped. */
  readonly answerHandoff: (completed: boolean) => Promise<void>;
}

/**
 * The session partition main forces onto every attached view. Declared here
 * (rather than imported from desktop-host) because the renderer must not pull
 * a node-only package into the browser bundle; the value is pinned by the
 * matching test on the main side.
 */
export const BROWSER_PARTITION_NAME = 'persist:moxxy-browser';

/**
 * Where a fresh tab starts, and what a typed phrase is searched with.
 *
 * On a profile that has never been there, Google answers with the EU consent
 * wall rather than results. That is not a wall the agent may clear — the choice
 * is the user's — so the snapshot flags it and the agent hands over. The
 * partition is persistent, so it is asked once and then never again.
 */
export const HOME_URL = 'https://www.google.com';

/** Turn what the user typed into something navigable. */
export function normalizeAddress(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  // A bare host gets https; anything with a space is a search, not an address.
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(raw)) return `https://${raw}`;
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

export function useBrowserTabs(): BrowserTabsApi {
  const [tabs, setTabs] = useState<ReadonlyArray<BrowserTabInfo>>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Survives re-renders so an unmount can release what this pane adopted even
  // if React has already discarded the state.
  const adopted = useRef<Set<string>>(new Set());
  /** pane key → the tab id main gave it, so a closed tab can be pruned. */
  const adoptedByPane = useRef<Map<string, string>>(new Map());
  const handoffRef = useRef<{ requestId: string; tabId: string; reason: string } | null>(null);
  /** tabId → how to focus that tab's view. */
  const views = useRef<Map<string, () => void>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const { tabs: next, activeTabId: active } = await api().invoke('browser.listTabs');
      setTabs(next);
      setActiveTabId(active);
      setError(null);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, []);

  const adopt = useCallback(
    async (webContentsId: number, requestId?: string) => {
      try {
        const { tabId } = await api().invoke(
          'browser.registerTab',
          requestId ? { webContentsId, requestId } : { webContentsId },
        );
        adopted.current.add(tabId);
        await refresh();
        return tabId;
      } catch (err) {
        setError(toErrorMessage(err));
        return null;
      }
    },
    [refresh],
  );

  const release = useCallback(
    async (tabId: string) => {
      adopted.current.delete(tabId);
      await api().invoke('browser.releaseTab', { tabId }).catch(() => {});
      await refresh();
    },
    [refresh],
  );

  const select = useCallback(
    async (tabId: string) => {
      try {
        await api().invoke('browser.selectTab', { tabId });
        await refresh();
      } catch (err) {
        setError(toErrorMessage(err));
      }
    },
    [refresh],
  );

  const navigate = useCallback(
    async (url: string, tabId?: string) => {
      try {
        await api().invoke('browser.navigate', tabId ? { url, tabId } : { url });
        await refresh();
      } catch (err) {
        setError(toErrorMessage(err));
      }
    },
    [refresh],
  );

  // One entry per <webview> this pane renders. The first is the user's home
  // tab; the rest arrive because the agent asked for them — main cannot create
  // the element itself, so it sends `browser.openTab` and we oblige.
  const [panes, setPanes] = useState<ReadonlyArray<{ key: string; initialUrl: string; requestId?: string }>>([
    { key: 'home', initialUrl: HOME_URL },
  ]);
  const paneSeq = useRef(0);
  const [handoff, setHandoff] = useState<{ requestId: string; tabId: string; reason: string } | null>(null);

  const openPane = useCallback((url: string) => {
    setPanes((prev) => [...prev, { key: `p${++paneSeq.current}`, initialUrl: url }]);
  }, []);

  /**
   * Close a tab by dropping the pane that hosts it.
   *
   * Main cannot close a tab on its own: the `<webview>` is a renderer element,
   * and main only ever borrowed its webContents. Unmounting is therefore the
   * close — the view is destroyed and `release` tells main to forget the tab.
   * A browser with zero tabs is a broken-looking empty rectangle with an
   * address bar, so the last close opens a fresh home tab instead.
   */
  const closeTab = useCallback(
    async (tabId: string) => {
      let hosted = false;
      setPanes((prev) => {
        const key = [...adoptedByPane.current.entries()].find(([, id]) => id === tabId)?.[0];
        if (key === undefined) return prev;
        hosted = true;
        adoptedByPane.current.delete(key);
        const left = prev.filter((pane) => pane.key !== key);
        return left.length > 0 ? left : [{ key: `p${++paneSeq.current}`, initialUrl: HOME_URL }];
      });
      // A tab main knows about but this pane never hosted (a stale id, or a
      // second pane's view) still deserves an answer rather than silence.
      if (!hosted) await release(tabId);
    },
    [release],
  );

  const history = useCallback(
    async (action: 'back' | 'forward' | 'reload', tabId?: string) => {
      try {
        await api().invoke('browser.history', tabId ? { action, tabId } : { action });
      } catch (err) {
        // "nothing to go back to" is an answer, not a fault — show it and move on.
        setError(toErrorMessage(err));
      }
    },
    [],
  );

  const answerHandoff = useCallback(async (completed: boolean) => {
    const current = handoffRef.current;
    if (!current) return;
    setHandoff(null);
    handoffRef.current = null;
    await api().invoke('browser.resolveHandoff', { requestId: current.requestId, completed }).catch(() => {});
  }, []);

  useEffect(() => {
    void refresh();
    const offOpen = api().subscribe('browser.openTab', ({ requestId, url }) => {
      setPanes((prev) => [...prev, { key: `agent-${requestId}`, initialUrl: url, requestId }]);
    });
    // The agent can switch, open and close tabs. Without this the strip would
    // show a set the page no longer matches.
    const offTabs = api().subscribe('browser.tabsChanged', ({ tabs: next, activeTabId: active }) => {
      setTabs(next);
      setActiveTabId(active);
      const live = new Set(next.map((t) => t.tabId));
      // Drop views main no longer knows about, so a tab the agent closed stops
      // being rendered instead of lingering as an orphan.
      setPanes((prev) => prev.filter((pane) => !adoptedByPane.current.has(pane.key) || live.has(adoptedByPane.current.get(pane.key)!)));
    });
    const offHandoff = api().subscribe('browser.handoffRequested', (req) => {
      handoffRef.current = req;
      setHandoff(req);
    });
    /**
     * Bring the tab forward, then focus its view, then say so.
     *
     * A hidden view cannot take focus — measured: the same key sequence does
     * nothing while the agent's tab sits behind another and works the moment it
     * is in front. Showing it is the honest thing anyway: the agent is about to
     * act there, and this browser exists so the user can see that happen.
     *
     * Answered even for a tab this pane does not host — main is holding a key
     * back until it hears something, and silence would park it until the
     * timeout.
     */
    const offFocus = api().subscribe('browser.focusTab', ({ requestId, tabId }) => {
      const done = (): void => {
        views.current.get(tabId)?.();
        void api().invoke('browser.confirmFocus', { requestId }).catch(() => {});
      };
      if (!views.current.has(tabId)) {
        done();
        return;
      }
      void api()
        .invoke('browser.selectTab', { tabId })
        .catch(() => {})
        // One frame for React to make the view visible; focus lands on nothing
        // otherwise, which is the bug this whole path exists to fix.
        .finally(() => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
    return () => {
      offOpen();
      offTabs();
      offHandoff();
      offFocus();
    };
  }, [refresh]);

  return {
    tabs,
    activeTabId,
    error,
    adopt,
    release,
    select,
    navigate,
    refresh,
    panes,
    openPane,
    closeTab,
    history,
    handoff,
    answerHandoff,
    noteAdoption: (paneKey: string, tabId: string) => adoptedByPane.current.set(paneKey, tabId),
    registerView: (tabId: string, focus: (() => void) | null) => {
      if (focus) views.current.set(tabId, focus);
      else views.current.delete(tabId);
    },
  };
}
