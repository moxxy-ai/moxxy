import { ScreenFrame } from '@/components/ScreenFrame';
import { SessionList } from '@/components/SessionList';
import { useGatewayStore } from '@/hooks/useGatewayStore';

export default function SessionsScreen() {
  const { permissions, session, sessions } = useGatewayStore();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;
  return (
    <ScreenFrame
      title="Sessions"
      subtitle="Workspaces"
      connected={session.connected}
      pendingActions={pendingActions}
    >
      <SessionList
        workspaces={sessions.workspaces}
        activeWorkspaceId={sessions.activeWorkspaceId}
        onSelectWorkspace={sessions.selectWorkspace}
        onNewSession={sessions.newSession}
      />
    </ScreenFrame>
  );
}
