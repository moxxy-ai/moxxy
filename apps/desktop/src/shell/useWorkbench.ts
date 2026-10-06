import { useCallback, useState } from 'react';
import type { WorkbenchTab } from './Workbench';
import { useAgentSurfaceReveal } from './surfaces/useAgentSurfaceReveal';

export interface WorkbenchState {
  /** The open pane, or null when the workbench is collapsed. */
  readonly tab: WorkbenchTab | null;
  readonly setTab: (tab: WorkbenchTab | null) => void;
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
  // Starts collapsed — collapsed still leaves a vertical tab strip, so the
  // panes stay discoverable and one click opens the one you want.
  const [tab, setTabState] = useState<WorkbenchTab | null>(null);
  const [full, setFull] = useState(false);

  const setTab = useCallback((next: WorkbenchTab | null): void => {
    setTabState(next);
    // Full view is a way of showing a pane; with none open it ends.
    if (next === null) setFull(false);
  }, []);

  const toggleFull = useCallback((): void => {
    setTabState((current) => current ?? 'browser');
    setFull((current) => !current);
  }, []);

  useAgentSurfaceReveal(workspaceId, setTab);
  return { tab, setTab, full, toggleFull };
}
