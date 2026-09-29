import { useState } from 'react';
import type { WorkbenchTab } from './Workbench';
import { useAgentSurfaceReveal } from './surfaces/useAgentSurfaceReveal';

/**
 * The workbench beside a chat: which pane is open (null = collapsed), opened
 * for you the first time that chat's agent drives its browser or terminal.
 * Every chat with a workbench — a workspace, a channel bot — uses this, so the
 * agent's work shows the same way wherever you talk to it.
 */
export function useWorkbench(
  workspaceId: string | null,
): readonly [WorkbenchTab | null, (tab: WorkbenchTab | null) => void] {
  // Starts collapsed — collapsed still leaves a vertical tab strip, so the
  // panes stay discoverable and one click opens the one you want.
  const [tab, setTab] = useState<WorkbenchTab | null>(null);
  useAgentSurfaceReveal(workspaceId, setTab);
  return [tab, setTab];
}
