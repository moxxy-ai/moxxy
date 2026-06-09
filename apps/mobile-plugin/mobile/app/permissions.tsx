import { AskSheet } from '@/components/AskSheet';
import { ScreenFrame } from '@/components/ScreenFrame';
import { useGatewayStore } from '@/hooks/useGatewayStore';

export default function PermissionsScreen() {
  const { permissions, session } = useGatewayStore();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;
  return (
    <ScreenFrame
      title="Actions"
      subtitle="Permissions and approvals"
      connected={session.connected}
      pendingActions={pendingActions}
    >
      <AskSheet
        asks={permissions.pendingAsks}
        permissions={permissions.pendingPermissions}
        onAskResponse={permissions.respondAsk}
        onPermissionDecision={permissions.decidePermission}
      />
    </ScreenFrame>
  );
}
