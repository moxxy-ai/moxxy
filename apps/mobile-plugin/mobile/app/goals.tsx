import { GoalSheet } from '@/components/GoalSheet';
import { ScreenFrame } from '@/components/ScreenFrame';
import { useGatewayStore } from '@/hooks/useGatewayStore';

export default function GoalsScreen() {
  const { goals, permissions, session } = useGatewayStore();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;
  return (
    <ScreenFrame
      title="Goals"
      subtitle="Autonomous mode"
      connected={session.connected}
      pendingActions={pendingActions}
    >
      <GoalSheet
        objective={goals.objective}
        canStart={goals.canStart}
        onObjectiveChange={goals.setObjective}
        onStart={goals.startGoal}
      />
    </ScreenFrame>
  );
}
