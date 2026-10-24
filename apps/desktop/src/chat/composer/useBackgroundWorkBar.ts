import { focusAgentWork, useAgentWork } from '@moxxy/client-core';
import { wakeupMeta } from '../../shell/surfaces/agents/agent-work-view';
import { useNow } from '../../lib/useNow';

export interface BackgroundWorkBarView {
  /** What runs, by name ("npm run dev, Check later"); null while nothing runs. */
  readonly running: { readonly text: string; readonly count: number } | null;
  /** The soonest time the agent comes back by itself; null while it set none. */
  readonly scheduled: { readonly when: string; readonly text: string; readonly more: number } | null;
  readonly open: () => void;
}

/** What the agent runs in the background now and when it comes back, said above the message box; null while neither. */
export function useBackgroundWorkBar(workspaceId: string): BackgroundWorkBarView | null {
  const work = useAgentWork(workspaceId);
  // "in 3 min" changes by the minute; a quarter of one keeps it from lagging.
  const now = useNow(15_000);
  const running = work.items.filter((item) => item.status === 'running');
  const [next, ...later] = work.scheduled;
  if (running.length === 0 && !next) return null;
  return {
    running: running.length > 0 ? { text: running.map((item) => item.label).join(', '), count: running.length } : null,
    scheduled: next ? { when: wakeupMeta(next, now), text: next.prompt, more: later.length } : null,
    open: () => focusAgentWork(workspaceId),
  };
}
