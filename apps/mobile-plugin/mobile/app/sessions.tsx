import { ScreenFrame } from '@/components/ScreenFrame';
import { SessionList } from '@/components/SessionList';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { buildWorkspaceMenuSections } from '@/navigation';

export default function SessionsScreen() {
  const { permissions, session, sessions } = useGatewayStore();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;
  const sections = buildWorkspaceMenuSections(sessions.workspaces, sessions.sessions, sessions.activeWorkspaceId);
  return (
    <ScreenFrame
      title="Sessions"
      subtitle="Workspaces"
      connected={session.connected}
      pendingActions={pendingActions}
    >
      <SessionList
        sections={sections}
        onSelectSession={sessions.selectWorkspace}
        onNewSession={sessions.newSession}
      />
    </ScreenFrame>
  );
}
