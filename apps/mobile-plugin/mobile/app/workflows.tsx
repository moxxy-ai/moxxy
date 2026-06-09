import { ScreenFrame } from '@/components/ScreenFrame';
import { WorkflowList } from '@/components/WorkflowList';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useEffect } from 'react';

export default function WorkflowsScreen() {
  const { permissions, session, workflows } = useGatewayStore();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;

  useEffect(() => {
    workflows.refresh();
  }, [workflows.refresh]);

  return (
    <ScreenFrame
      title="Workflows"
      subtitle="Saved automations"
      connected={session.connected}
      pendingActions={pendingActions}
    >
      <WorkflowList workflows={workflows.workflows} onRefresh={workflows.refresh} onRun={workflows.run} />
    </ScreenFrame>
  );
}
