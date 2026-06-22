import { useEffect } from 'react';
import { api } from '@moxxy/client-core';
import { railPaneForTool, type RailPane } from '../ContextRail';

/**
 * Auto-reveal the matching rail pane the first time the agent uses its
 * browser / terminal tool, so its work is shown to the user without them
 * having to open the pane manually ("showcase its work"). Renderer-only: we
 * observe the SAME `runner.event` stream the transcript renders and call
 * `reveal` for the active workspace — no runner / protocol change.
 *
 * Each pane is revealed at most once per workspace session: the showcase
 * happens at the meaningful moment (the agent's first navigation / first
 * command) and we never fight the user by reopening a pane they've closed.
 * We never auto-CLOSE — the rail's close button stays authoritative.
 */
export function useAgentSurfaceReveal(
  workspaceId: string | null,
  reveal: (pane: RailPane) => void,
): void {
  useEffect(() => {
    if (!workspaceId) return;
    // Reset per workspace — a fresh session showcases afresh.
    const revealed = new Set<RailPane>();
    return api().subscribe('runner.event', ({ workspaceId: wid, event }) => {
      if (wid !== workspaceId || event.type !== 'tool_call_requested') return;
      const pane = railPaneForTool(event.name);
      if (!pane || revealed.has(pane)) return;
      revealed.add(pane);
      reveal(pane);
    });
  }, [workspaceId, reveal]);
}
