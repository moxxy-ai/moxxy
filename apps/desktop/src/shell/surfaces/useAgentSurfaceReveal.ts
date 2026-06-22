import { useEffect } from 'react';
import { api } from '@moxxy/client-core';
import { revealForTool, type FileSelection, type RailPane } from './registry';

/**
 * Auto-reveal the matching embedded pane the first time the agent uses a tool
 * that has a surface (browser / terminal / file writes). Registry-driven: the
 * pane (and, for Write/Edit, the file path + diff/content mode) comes from
 * {@link revealForTool}, so adding a surface-backed pane needs no edit here.
 *
 * Renderer-only: we observe the SAME `runner.event` stream the transcript
 * renders — no runner / protocol change. We never auto-CLOSE, and reveal each
 * pane at most once per session (a fresh write to a *different* file still
 * updates the path). We never fight a user who has closed a pane.
 */
export function useAgentSurfaceReveal(
  workspaceId: string | null,
  reveal: (pane: RailPane, file?: FileSelection) => void,
): void {
  useEffect(() => {
    if (!workspaceId) return;
    const revealed = new Set<RailPane>();
    let lastFilePath: string | null = null;
    return api().subscribe('runner.event', ({ workspaceId: wid, event }) => {
      if (wid !== workspaceId || event.type !== 'tool_call_requested') return;
      const target = revealForTool(event.name, event.input);
      if (!target) return;
      // The file pane re-reveals when a DIFFERENT file is written (so the panel
      // tracks the agent's current file); other panes only the first time.
      if (target.kind === 'file' && target.file) {
        if (target.file.path === lastFilePath && revealed.has('file')) return;
        lastFilePath = target.file.path;
        revealed.add('file');
        reveal('file', target.file);
        return;
      }
      if (revealed.has(target.kind)) return;
      revealed.add(target.kind);
      reveal(target.kind);
    });
  }, [workspaceId, reveal]);
}
