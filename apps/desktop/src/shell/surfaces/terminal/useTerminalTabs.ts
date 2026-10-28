import { useCallback, useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { TerminalTabInfo } from '@moxxy/desktop-ipc-contract';

/** The first tab: the agent's terminal, the chat's runner's `terminal` surface. */
export const AGENT_TAB = 'agent';

/** The tab each chat's pane showed last, so opening the pane again shows it. */
const shown = new Map<string, string>();

export interface UseTerminalTabs {
  /** The project's own tabs, after the Agent tab. */
  readonly tabs: ReadonlyArray<TerminalTabInfo>;
  /** {@link AGENT_TAB} or a tab id. A tab that is gone falls back to the Agent tab. */
  readonly active: string;
  readonly select: (tabId: string) => void;
  /** Open a tab in the project's folder and show it. */
  readonly open: () => Promise<void>;
  /** Close a tab and stop what was started from it. */
  readonly close: (tabId: string) => Promise<void>;
}

/**
 * The terminal pane's tabs for a chat: the Agent tab, then the shells of the
 * chat's project (main-owned, so every chat of the project lists the same
 * ones), read again whenever main says they changed.
 */
export function useTerminalTabs(workspaceId: string | null): UseTerminalTabs {
  const [tabs, setTabs] = useState<ReadonlyArray<TerminalTabInfo>>([]);
  const [chosen, setChosen] = useState<{ readonly workspaceId: string | null; readonly tabId: string } | null>(null);

  useEffect(() => {
    setTabs([]);
    if (!workspaceId) return undefined;
    let live = true;
    const read = (): void => {
      void api()
        .invoke('terminal.list', { workspaceId })
        .then((next) => {
          if (live) setTabs(next);
        })
        .catch(() => undefined);
    };
    read();
    const off = api().subscribe('terminal.tabsChanged', read);
    return () => {
      live = false;
      off();
    };
  }, [workspaceId]);

  const select = useCallback(
    (tabId: string): void => {
      setChosen({ workspaceId, tabId });
      if (workspaceId) shown.set(workspaceId, tabId);
    },
    [workspaceId],
  );

  const open = useCallback(async (): Promise<void> => {
    if (!workspaceId) return;
    const tab = await api().invoke('terminal.open', { workspaceId });
    setTabs((all) => (all.some((t) => t.id === tab.id) ? all : [...all, tab]));
    select(tab.id);
  }, [workspaceId, select]);

  const close = useCallback(async (tabId: string): Promise<void> => {
    await api().invoke('terminal.close', { tabId });
    setTabs((all) => all.filter((t) => t.id !== tabId));
  }, []);

  const wanted = chosen?.workspaceId === workspaceId ? chosen.tabId : ((workspaceId && shown.get(workspaceId)) ?? AGENT_TAB);
  const active = tabs.some((t) => t.id === wanted) ? wanted : AGENT_TAB;
  return { tabs, active, select, open, close };
}
