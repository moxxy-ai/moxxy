import { useCallback, useRef, useState } from 'react';
import type { WorkbenchTab } from './Workbench';
import { useAgentSurfaceReveal } from './surfaces/useAgentSurfaceReveal';

/** The pane a first open lands on, before any pane has been used. */
const FIRST_TAB: WorkbenchTab = 'files';

export interface WorkbenchState {
  /** The open pane, or null when the workbench is closed. */
  readonly tab: WorkbenchTab | null;
  readonly open: boolean;
  readonly setTab: (tab: WorkbenchTab | null) => void;
  /** Close it, or open it on the pane last in use. The header's button and the
   *  shortcut both call this, so they agree on which pane comes back. */
  readonly toggle: () => void;
  /** The open pane fills the window and the chat floats over it as a composer. */
  readonly full: boolean;
  /** Into full view and out again; with nothing open, opens the browser in it. */
  readonly toggleFull: () => void;
}

/**
 * The workbench beside a chat: which pane is open, whether it is in full view,
 * and the pane opened for you the first time that chat's agent drives its
 * browser or terminal. Every chat with a workbench — a workspace, a channel
 * bot — uses this, so the agent's work shows the same way wherever you talk to
 * it.
 */
export function useWorkbench(workspaceId: string | null): WorkbenchState {
  // Starts closed, and closed it takes no room: the run's header opens it.
  const [tab, setTabState] = useState<WorkbenchTab | null>(null);
  const [full, setFull] = useState(false);
  const lastTab = useRef<WorkbenchTab>(FIRST_TAB);

  const setTab = useCallback((next: WorkbenchTab | null): void => {
    if (next !== null) lastTab.current = next;
    setTabState(next);
    // Full view is a way of showing a pane; with none open it ends.
    if (next === null) setFull(false);
  }, []);

  const toggle = useCallback((): void => {
    setTab(tab === null ? lastTab.current : null);
  }, [tab, setTab]);

  const toggleFull = useCallback((): void => {
    if (tab === null) setTab('browser');
    setFull((current) => !current);
  }, [tab, setTab]);

  useAgentSurfaceReveal(workspaceId, setTab);
  return { tab, open: tab !== null, setTab, toggle, full, toggleFull };
}
