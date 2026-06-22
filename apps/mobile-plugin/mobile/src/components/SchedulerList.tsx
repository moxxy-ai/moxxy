import { sx } from '../styles/tokens';
import { Pressable, Text, View } from 'react-native';
import type { MobileSchedule } from '../schedulerUi';
import { buildScheduleAccessibilityLabel } from '../schedulerUi';
import { MobileIcon } from './MobileIcon';

interface SchedulerListProps {
  readonly schedules: ReadonlyArray<MobileSchedule>;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRefresh: () => void;
  readonly onToggle: (id: string, enabled: boolean) => void;
  readonly onDelete: (schedule: MobileSchedule) => void;
}

export function SchedulerList({
  schedules,
  loading = false,
  error = null,
  onRefresh,
  onToggle,
  onDelete,
}: SchedulerListProps) {
  return (
    <View style={sx('gap-3')}>
      <Pressable
        style={sx('min-h-12 flex-row items-center justify-center gap-2 rounded-card border border-cardBorder bg-cardBg')}
        onPress={onRefresh}
        accessibilityRole="button"
      >
        <MobileIcon name="scheduler" size={18} strokeWidth={2.35} color="#475569" />
        <Text style={sx('text-[13px] font-bold text-muted')}>
          {loading ? 'Refreshing scheduler...' : 'Refresh scheduler'}
        </Text>
      </Pressable>

      {error ? (
        <View style={sx('rounded-card border border-red/20 bg-red/10 p-4')}>
          <Text style={sx('text-[14px] font-black text-red')}>Scheduler error</Text>
          <Text style={sx('mt-1 text-[13px] leading-5 text-red')}>{error}</Text>
        </View>
      ) : null}

      {schedules.length === 0 ? (
        <View style={sx('rounded-card border border-cardBorder bg-cardBg p-5 shadow-card', { shadowOpacity: 0.08 })}>
          <Text style={sx('text-[16px] font-black text-text')}>No schedules visible</Text>
          <Text style={sx('mt-1 text-[13px] leading-5 text-muted')}>
            Cron jobs and one-shot scheduled prompts will appear here after they are created by the agent or desktop.
          </Text>
        </View>
      ) : null}

      {schedules.map((schedule) => (
        <View
          key={schedule.id}
          style={sx('rounded-card border border-cardBorder bg-cardBg p-4 shadow-card', { shadowOpacity: 0.08 })}
          accessibilityLabel={buildScheduleAccessibilityLabel(schedule)}
        >
          <View style={sx('flex-row items-start gap-3')}>
            <View style={sx(`mt-1.5 h-2.5 w-2.5 rounded-pill ${schedule.enabled ? 'bg-green' : 'bg-cardBorderStrong'}`)} />
            <View style={sx('min-w-0 flex-1')}>
              <View style={sx('flex-row items-start justify-between gap-3')}>
                <View style={sx('min-w-0 flex-1')}>
                  <Text style={sx('text-[16px] font-black leading-6 text-text')}>{schedule.name}</Text>
                  {schedule.promptPreview ? (
                    <Text style={sx('mt-1 text-[13px] leading-5 text-muted')} numberOfLines={3}>
                      {schedule.promptPreview}
                    </Text>
                  ) : null}
                </View>
                <StatusPill enabled={schedule.enabled} label={schedule.statusLabel} />
              </View>

              <View style={sx('mt-3 flex-row flex-wrap gap-2')}>
                <Badge label={schedule.sourceLabel} tone="muted" />
                {schedule.ownerLabel ? <Badge label={schedule.ownerLabel} tone="muted" /> : null}
                <Badge label={schedule.timingLabel} tone="muted" />
                {schedule.nextFireLabel ? <Badge label={schedule.nextFireLabel} tone="muted" /> : null}
                <Badge label={schedule.outcomeLabel} tone={schedule.outcomeLabel.endsWith('failed') ? 'danger' : 'muted'} />
              </View>

              {schedule.lastError ? (
                <Text style={sx('mt-3 text-[12px] leading-5 text-red')} numberOfLines={3}>
                  {schedule.lastError}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={sx('mt-4 flex-row gap-2')}>
            <Pressable
              style={sx(`min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-pill px-4 ${
                schedule.enabled ? 'bg-appBg' : 'bg-primary'
              }`)}
              onPress={() => onToggle(schedule.id, !schedule.enabled)}
              accessibilityRole="button"
            >
              <MobileIcon
                name={schedule.enabled ? 'stop' : 'check'}
                size={16}
                strokeWidth={2.5}
                color={schedule.enabled ? '#475569' : '#ffffff'}
              />
              <Text style={sx(`text-[13px] font-black ${schedule.enabled ? 'text-muted' : 'text-white'}`)}>
                {schedule.enabled ? 'Pause' : 'Enable'}
              </Text>
            </Pressable>
            <Pressable
              style={sx('min-h-11 flex-row items-center justify-center gap-2 rounded-pill border border-red/20 px-4')}
              onPress={() => onDelete(schedule)}
              accessibilityRole="button"
            >
              <MobileIcon name="x" size={16} strokeWidth={2.5} color="#ef4444" />
              <Text style={sx('text-[13px] font-black text-red')}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function StatusPill({ enabled, label }: { readonly enabled: boolean; readonly label: string }) {
  return (
    <View style={sx(`rounded-pill px-3 py-1 ${enabled ? 'bg-green/10' : 'bg-appBg'}`)}>
      <Text style={sx(`text-[11px] font-black ${enabled ? 'text-green' : 'text-muted'}`)}>{label}</Text>
    </View>
  );
}

function Badge({ label, tone }: { readonly label: string; readonly tone: 'danger' | 'muted' }) {
  return (
    <View style={sx(`rounded-pill px-3 py-1 ${tone === 'danger' ? 'bg-red/10' : 'bg-appBg'}`)}>
      <Text style={sx(`text-[11px] font-black ${tone === 'danger' ? 'text-red' : 'text-muted'}`)}>{label}</Text>
    </View>
  );
}
