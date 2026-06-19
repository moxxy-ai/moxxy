import { Alert } from 'react-native';
import { useEffect } from 'react';
import { ScreenFrame } from '@/components/ScreenFrame';
import { SchedulerList } from '@/components/SchedulerList';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import type { MobileSchedule } from '@/schedulerUi';

export default function SchedulerScreen() {
  const { permissions, scheduler, session } = useGatewayStore();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;

  useEffect(() => {
    scheduler.refresh();
  }, [scheduler.refresh]);

  const confirmDelete = (schedule: MobileSchedule) => {
    Alert.alert(
      'Delete schedule?',
      `This permanently removes "${schedule.name}" from the scheduler.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => scheduler.deleteSchedule(schedule.id),
        },
      ],
    );
  };

  return (
    <ScreenFrame
      title="Scheduler"
      subtitle="Cron jobs and timed prompts"
      connected={session.connected}
      pendingActions={pendingActions}
    >
      <SchedulerList
        schedules={scheduler.schedules}
        loading={scheduler.loading}
        error={scheduler.error}
        onRefresh={scheduler.refresh}
        onToggle={scheduler.setEnabled}
        onDelete={confirmDelete}
      />
    </ScreenFrame>
  );
}
