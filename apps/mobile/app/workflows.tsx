import { ScreenFrame } from '@/components/ScreenFrame';
import { WorkflowList } from '@/components/WorkflowList';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { workflowEditHref } from '@/workflowEditNav';

export default function WorkflowsScreen() {
  const router = useRouter();
  const { permissions, session, workflows } = useGatewayStore();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;

  useEffect(() => {
    workflows.refresh();
  }, [workflows.refresh]);

  const onEdit = (name: string | null): void => {
    router.push(workflowEditHref(name));
  };

  return (
    <ScreenFrame
      title="Workflows"
      subtitle="Saved automations"
      connected={session.connected}
      pendingActions={pendingActions}
    >
      <WorkflowList
        workflows={workflows.workflows}
        onRefresh={workflows.refresh}
        onRun={workflows.run}
        onEdit={onEdit}
      />
    </ScreenFrame>
  );
}
