import type { WorkspaceMenuSection } from '@/navigation';
import { WorkspaceSessionTree } from './WorkspaceSessionTree';

interface SessionListProps {
  readonly sections: ReadonlyArray<WorkspaceMenuSection>;
  readonly collapsedWorkspaceIds: ReadonlyArray<string>;
  readonly onSelectSession: (id: string) => void;
  readonly onToggleWorkspace: (workspaceId: string) => void;
  readonly onNewSession: () => void;
}

export function SessionList(props: SessionListProps) {
  return (
    <WorkspaceSessionTree
      sections={props.sections}
      collapsedWorkspaceIds={props.collapsedWorkspaceIds}
      showGlobalNewSession
      onSelectSession={props.onSelectSession}
      onToggleWorkspace={props.onToggleWorkspace}
      onNewSession={props.onNewSession}
    />
  );
}
