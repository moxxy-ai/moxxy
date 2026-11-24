import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { Workbench } from './Workbench';
import { useWorkbench, type WorkbenchState } from './useWorkbench';

type ChatPanel = Pick<WorkbenchState, 'tab' | 'setTab' | 'full' | 'toggleFull'> & { workspaceId: string };
const ChannelPanel = createContext<((panel: ChatPanel | null) => void) | null>(null);

/** The window owns the webviews. A workspace or channel chat supplies the controls. */
export function WindowWorkbench({ workspace, children }: { workspace: ChatPanel; children: ReactNode }): JSX.Element {
  const [channel, setChannel] = useState<ChatPanel | null>(null);
  const panel = channel ?? workspace;
  return (
    <ChannelPanel.Provider value={setChannel}>
      {children}
      <Workbench
        workspaceId={panel.workspaceId}
        tab={panel.tab}
        onPick={panel.setTab}
        onClose={() => panel.setTab(null)}
        full={panel.full}
        onToggleFull={panel.toggleFull}
      />
    </ChannelPanel.Provider>
  );
}

export function useChannelWorkbench(workspaceId: string): WorkbenchState {
  const bench = useWorkbench(workspaceId);
  const { tab, setTab, full, toggleFull } = bench;
  const publish = useContext(ChannelPanel);
  useLayoutEffect(() => {
    if (!publish) throw new Error('A channel chat needs the window workbench');
    publish({ workspaceId, tab, setTab, full, toggleFull });
    return () => publish(null);
  }, [publish, workspaceId, tab, setTab, full, toggleFull]);
  return bench;
}
