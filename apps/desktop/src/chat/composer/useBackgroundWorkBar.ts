import { focusAgentWork, useAgentWork } from '@moxxy/client-core';

export interface BackgroundWorkBarView {
  /** What runs, by name ("npm run dev, Check later"). */
  readonly text: string;
  readonly count: number;
  readonly open: () => void;
}

/** What the agent runs in the background now, said above the message box; null while nothing runs. */
export function useBackgroundWorkBar(workspaceId: string): BackgroundWorkBarView | null {
  const work = useAgentWork(workspaceId);
  const running = work.items.filter((item) => item.status === 'running');
  if (running.length === 0) return null;
  return {
    text: running.map((item) => item.label).join(', '),
    count: running.length,
    open: () => focusAgentWork(workspaceId),
  };
}
