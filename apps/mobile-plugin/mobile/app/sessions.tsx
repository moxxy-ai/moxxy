import { ScreenFrame } from '@/components/ScreenFrame';
import { SessionList } from '@/components/SessionList';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useWorkspaceCollapse } from '@/hooks/useWorkspaceCollapse';
import { buildWorkspaceMenuSections } from '@/navigation';

export default function SessionsScreen() {
  const { permissions, session, sessions } = useGatewayStore();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;
  const sections = buildWorkspaceMenuSections(sessions.workspaces, sessions.sessions, sessions.activeWorkspaceId);
  const workspaceCollapse = useWorkspaceCollapse(sections, 4);
  return (
    <ScreenFrame
      title="Sessions"
      subtitle="Workspaces"
      connected={session.connected}
      pendingActions={pendingActions}
    >
      <SessionList
        sections={sections}
        collapsedWorkspaceIds={workspaceCollapse.collapsedWorkspaceIds}
        onSelectSession={sessions.selectWorkspace}
        onToggleWorkspace={workspaceCollapse.toggleWorkspace}
        onNewSession={sessions.newSession}
      />
    </ScreenFrame>
  );
}
