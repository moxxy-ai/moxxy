import { useEffect } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Button,
  Card,
  DetailHeader,
  EmptyState,
  IconBadge,
  IconButton,
  Pill,
} from '@/ui/kit';
import { useTheme } from '@/theme/ThemeProvider';
import { sx } from '@/styles/tokens';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import type { MobileSchedule } from '@/schedulerUi';

export default function SchedulerScreen() {
  const { colors } = useTheme();
  const { scheduler, sessionLoading } = useGatewayStore();
  const router = useRouter();

  useEffect(() => {
    if (!sessionLoading) scheduler.refresh();
  }, [sessionLoading]);

  const confirmDelete = (schedule: MobileSchedule) => {
    Alert.alert('Delete schedule?', schedule.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => scheduler.deleteSchedule(schedule.id),
      },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.appBg }}>
      <View style={[sx('flex-1'), { backgroundColor: colors.appBg }]}>
        <DetailHeader
          title="Schedules"
          subtitle={`${scheduler.schedules.length} scheduled`}
          onBack={() => router.back()}
          right={
            <IconButton
              icon="refresh"
              variant="ghost"
              accessibilityLabel="Refresh"
              onPress={() => scheduler.refresh()}
            />
          }
        />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
          {scheduler.error ? (
            <Card style={{ backgroundColor: colors.redSoft, borderColor: colors.redBorder }}>
              <View style={sx('flex-row items-center', { gap: 12 })}>
                <IconBadge icon="bolt" tone="danger" size={34} />
                <View style={sx('flex-1', { minWidth: 0 })}>
                  <Text style={sx('text-[14px] font-bold', { color: colors.redText })}>
                    Could not load schedules
                  </Text>
                  <Text
                    style={sx('text-[13px] font-medium', { color: colors.redText, marginTop: 2 })}
                  >
                    {scheduler.error}
                  </Text>
                </View>
              </View>
            </Card>
          ) : null}

          {scheduler.schedules.map((schedule) => (
            <Card key={schedule.id}>
              <View style={sx('flex-row items-center', { gap: 12 })}>
                <IconBadge icon="scheduler" tone="info" size={38} />
                <Text style={sx('flex-1 text-[16px] font-black text-text', { minWidth: 0 })} numberOfLines={1}>
                  {schedule.name}
                </Text>
                <Switch
                  trackColor={{ false: colors.cardBorderStrong, true: colors.primary }}
                  thumbColor={colors.white}
                  ios_backgroundColor={colors.inputSoft}
                  value={schedule.enabled}
                  onValueChange={(v) => scheduler.setEnabled(schedule.id, v)}
                />
              </View>

              <View style={sx('flex-row flex-wrap items-center', { gap: 6, marginTop: 12 })}>
                <Pill label={schedule.statusLabel} tone={schedule.enabled ? 'success' : 'neutral'} />
                <Pill label={schedule.sourceLabel} tone="neutral" />
              </View>

              <View style={{ gap: 4, marginTop: 12 }}>
                <Text style={sx('text-[13px] font-semibold', { color: colors.textMuted })}>
                  {schedule.timingLabel}
                </Text>
                {schedule.nextFireLabel ? (
                  <Text style={sx('text-[13px] font-medium', { color: colors.textDim })}>
                    {`Next: ${schedule.nextFireLabel}`}
                  </Text>
                ) : null}
                {schedule.ownerLabel ? (
                  <Text style={sx('text-[13px] font-medium', { color: colors.textDim })}>
                    {schedule.ownerLabel}
                  </Text>
                ) : null}
                {schedule.promptPreview ? (
                  <Text
                    style={sx('text-[13px] font-medium', { color: colors.textDim, lineHeight: 18 })}
                    numberOfLines={2}
                  >
                    {schedule.promptPreview}
                  </Text>
                ) : null}
                {schedule.lastError ? (
                  <Text
                    style={sx('text-[12px] font-semibold', { color: colors.red })}
                    numberOfLines={2}
                  >
                    {schedule.lastError}
                  </Text>
                ) : null}
              </View>

              <View style={{ marginTop: 14 }}>
                <Button
                  variant="danger"
                  size="md"
                  label="Delete"
                  icon="trash"
                  onPress={() => confirmDelete(schedule)}
                />
              </View>
            </Card>
          ))}

          {scheduler.schedules.length === 0 ? (
            <EmptyState
              icon="scheduler"
              title="No schedules"
              body="Scheduled and recurring runs will appear here."
            />
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
