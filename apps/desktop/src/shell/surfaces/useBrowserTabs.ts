import { useCallback, useEffect, useRef, useState } from 'react';
import { useBrowserPanes } from './useBrowserPanes';
export { HOME_URL } from './useBrowserPanes';
import { api, toErrorMessage } from '@moxxy/client-core';
import type { BrowserControlState, BrowserTabInfo } from '@moxxy/desktop-ipc-contract';

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
  /** Who drives the browser — the agent, or the person who took it over — as main holds it. */
  readonly control: BrowserControlState;
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
  readonly handoff: {
    readonly requestId: string;
    readonly tabId: string;
    readonly reason: string;
    /** False when the page has the thing but it is not in view — the pane says
     *  so rather than asking for a press on something invisible. */
    readonly onScreen: boolean;
    /** What the page calls the control, when one was found. */
    readonly label?: string;
  } | null;
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

/** Turn what the user typed into something navigable. */
export function normalizeAddress(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  // A bare host gets https; anything with a space is a search, not an address.
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(raw)) return `https://${raw}`;
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

const AGENT_DRIVES: BrowserControlState = { driver: 'agent', turnId: null };

export function useBrowserTabs(): BrowserTabsApi {
  const [tabs, setTabs] = useState<ReadonlyArray<BrowserTabInfo>>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [control, setControl] = useState<BrowserControlState>(AGENT_DRIVES);
  const [error, setError] = useState<string | null>(null);
  const handoffRef = useRef<{
    requestId: string;
    tabId: string;
    reason: string;
    onScreen: boolean;
    label?: string;
  } | null>(null);
  /** tabId → how to focus that tab's view. */
  const views = useRef<Map<string, () => void>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const { tabs: next, activeTabId: active, control: drives } = await api().invoke('browser.listTabs');
      setTabs(next);
      setActiveTabId(active);
      // An older main answers without it; the agent driving is what that main means.
      setControl(drives ?? AGENT_DRIVES);
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

  const { panes, openPane, closeHostedTab, openAgentPane, reconcile, noteAdoption } = useBrowserPanes();
  const closeTab = useCallback(async (tabId: string) => {
    if (!closeHostedTab(tabId)) await release(tabId);
  }, [closeHostedTab, release]);
  const [handoff, setHandoff] = useState<{
    requestId: string;
    tabId: string;
    reason: string;
    onScreen: boolean;
    label?: string;
  } | null>(null);

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
      openAgentPane(requestId, url);
    });
    // The agent can switch, open and close tabs. Without this the strip would
    // show a set the page no longer matches.
    const offTabs = api().subscribe('browser.tabsChanged', ({ tabs: next, activeTabId: active, control: drives }) => {
      setTabs(next);
      setActiveTabId(active);
      setControl(drives ?? AGENT_DRIVES);
      reconcile(next);
    });
    /**
     * Show what is being asked about, then ask.
     *
     * Seen live: the pane sat on one tab while the consent banner it was asking
     * about was on another, so the person was told to press something that was
     * not in front of them — and pressing Done without doing anything leaves the
     * wall exactly where it was, so the question came straight back. Main scrolls
     * to the control; bringing its tab forward is this side's half.
     */
    const offHandoff = api().subscribe('browser.handoffRequested', (req) => {
      handoffRef.current = req;
      setHandoff(req);
      void api().invoke('browser.selectTab', { tabId: req.tabId }).catch(() => {});
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
  }, [refresh, openAgentPane, reconcile]);

  return {
    tabs,
    activeTabId,
    control,
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
    noteAdoption,
    registerView: (tabId: string, focus: (() => void) | null) => {
      if (focus) views.current.set(tabId, focus);
      else views.current.delete(tabId);
    },
  };
}
