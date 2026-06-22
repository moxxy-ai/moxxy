import { ScreenFrame } from '@/components/ScreenFrame';
import { SessionLoadingNotice } from '@/components/SessionLoadingNotice';
import { WorkflowList } from '@/components/WorkflowList';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useEffect } from 'react';

export default function WorkflowsScreen() {
  const { permissions, session, sessionLoading, workflows } = useGatewayStore();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;

  useEffect(() => {
    if (sessionLoading) return;
    workflows.refresh();
  }, [sessionLoading, workflows.refresh]);

  return (
    <ScreenFrame
      title="Workflows"
      subtitle="Saved automations"
      connected={session.connected}
      pendingActions={pendingActions}
    >
      {sessionLoading ? (
        <SessionLoadingNotice
          title="Session is loading"
          body="Workflows will be available as soon as the selected session runner is ready."
          icon="workflows"
        />
      ) : (
        <WorkflowList workflows={workflows.workflows} onRefresh={workflows.refresh} onRun={workflows.run} />
      )}
    </ScreenFrame>
  );
}
