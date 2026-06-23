import { StyleSheet, Text, View } from 'react-native';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import type { MobileSchedule } from '../schedulerUi';
import { buildScheduleAccessibilityLabel } from '../schedulerUi';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { Appear, PressableScale, PulseDot } from './primitives/motion';

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
    <View style={styles.stack}>
      <View style={styles.sectionHeader}>
        <Gradient preset="accent" radius={11} style={styles.sectionIcon}>
          <MobileIcon name="scheduler" size={17} strokeWidth={2.3} color="#ffffff" />
        </Gradient>
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>Scheduler</Text>
          <Text style={styles.sectionSubtitle}>
            {loading
              ? 'Refreshing scheduler...'
              : schedules.length === 0
                ? 'No scheduled jobs'
                : `${schedules.length} scheduled job${schedules.length === 1 ? '' : 's'}`}
          </Text>
        </View>
        <PressableScale style={styles.refreshButton} scaleTo={0.94} onPress={onRefresh} accessibilityRole="button">
          <MobileIcon name="actions" size={18} strokeWidth={2.4} color="#0891b2" />
        </PressableScale>
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Scheduler error</Text>
          <Text style={styles.errorBody}>{error}</Text>
        </View>
      ) : null}

      {schedules.length === 0 ? (
        <Appear from="up" distance={12}>
          <View style={styles.emptyCard}>
            <Gradient preset="accent" radius={18} style={styles.emptyBadge}>
              <MobileIcon name="scheduler" size={26} strokeWidth={2.3} color="#ffffff" />
            </Gradient>
            <Text style={styles.emptyTitle}>No schedules visible</Text>
            <Text style={styles.emptyBody}>
              Cron jobs and one-shot scheduled prompts will appear here after they are created by the agent or desktop.
            </Text>
          </View>
        </Appear>
      ) : null}

      {schedules.map((schedule) => (
        <View key={schedule.id} style={styles.card} accessibilityLabel={buildScheduleAccessibilityLabel(schedule)}>
          <View style={styles.cardRow}>
            <PulseDot
              color={schedule.enabled ? '#10b981' : '#cbd2e1'}
              size={10}
              pulsing={schedule.enabled}
              style={styles.dot}
            />
            <View style={styles.cardBody}>
              <View style={styles.titleRow}>
                <View style={styles.titleCopy}>
                  <Text style={styles.scheduleName}>{schedule.name}</Text>
                  {schedule.promptPreview ? (
                    <Text style={styles.schedulePreview} numberOfLines={3}>
                      {schedule.promptPreview}
                    </Text>
                  ) : null}
                </View>
                <StatusPill enabled={schedule.enabled} label={schedule.statusLabel} />
              </View>

              <View style={styles.badges}>
                <Badge label={schedule.sourceLabel} tone="muted" />
                {schedule.ownerLabel ? <Badge label={schedule.ownerLabel} tone="muted" /> : null}
                <Badge label={schedule.timingLabel} tone="muted" />
                {schedule.nextFireLabel ? <Badge label={schedule.nextFireLabel} tone="muted" /> : null}
                <Badge label={schedule.outcomeLabel} tone={schedule.outcomeLabel.endsWith('failed') ? 'danger' : 'muted'} />
              </View>

              {schedule.lastError ? (
                <Text style={styles.lastError} numberOfLines={3}>
                  {schedule.lastError}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.actionRow}>
            <PressableScale
              style={[styles.toggleButton, schedule.enabled ? styles.toggleSecondary : styles.togglePrimary]}
              scaleTo={0.97}
              onPress={() => onToggle(schedule.id, !schedule.enabled)}
              accessibilityRole="button"
            >
              {schedule.enabled ? null : <Gradient preset="cta" radius={999} style={StyleSheet.absoluteFill} />}
              <MobileIcon
                name={schedule.enabled ? 'stop' : 'check'}
                size={16}
                strokeWidth={2.5}
                color={schedule.enabled ? mobileInk.muted : '#ffffff'}
              />
              <Text style={[styles.toggleText, schedule.enabled ? styles.toggleTextSecondary : styles.toggleTextPrimary]}>
                {schedule.enabled ? 'Pause' : 'Enable'}
              </Text>
            </PressableScale>
            <PressableScale
              style={styles.deleteButton}
              scaleTo={0.97}
              onPress={() => onDelete(schedule)}
              accessibilityRole="button"
            >
              <MobileIcon name="x" size={16} strokeWidth={2.5} color="#ef4444" />
              <Text style={styles.deleteText}>Delete</Text>
            </PressableScale>
          </View>
        </View>
      ))}
    </View>
  );
}

function StatusPill({ enabled, label }: { readonly enabled: boolean; readonly label: string }) {
  return (
    <View style={[styles.pill, enabled ? styles.pillGreen : null]}>
      {enabled ? <PulseDot color="#10b981" size={6} pulsing /> : null}
      <Text style={[styles.pillText, enabled ? styles.pillTextGreen : null]}>{label}</Text>
    </View>
  );
}

function Badge({ label, tone }: { readonly label: string; readonly tone: 'danger' | 'muted' }) {
  return (
    <View style={[styles.badge, tone === 'danger' ? styles.badgeDanger : null]}>
      <Text style={[styles.badgeText, tone === 'danger' ? styles.badgeTextDanger : null]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  badge: {
    backgroundColor: 'rgba(241,242,249,0.9)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  badgeDanger: {
    backgroundColor: 'rgba(239,68,68,0.1)',
  },
  badgeText: {
    color: mobileInk.muted,
    fontSize: 11,
    fontWeight: '900',
  },
  badgeTextDanger: {
    color: '#ef4444',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  card: {
    backgroundColor: mobileGlass.card.fill,
    borderColor: mobileGlass.card.border,
    borderRadius: 20,
    borderTopColor: mobileGlass.card.hairline,
    borderWidth: 1,
    padding: 16,
    ...mobileElevation.md,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  deleteButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(239,68,68,0.25)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  deleteText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '900',
  },
  dot: {
    marginTop: 6,
  },
  emptyBadge: {
    alignItems: 'center',
    height: 56,
    justifyContent: 'center',
    marginBottom: 16,
    width: 56,
  },
  emptyBody: {
    color: mobileInk.soft,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
    textAlign: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: mobileGlass.card.fill,
    borderColor: mobileGlass.card.border,
    borderRadius: 22,
    borderTopColor: mobileGlass.card.hairline,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    ...mobileElevation.md,
  },
  emptyTitle: {
    color: mobileInk.strong,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  errorBody: {
    color: '#ef4444',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  errorCard: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  errorTitle: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '900',
  },
  lastError: {
    color: '#ef4444',
    fontSize: 12,
    lineHeight: 20,
    marginTop: 12,
  },
  pill: {
    alignItems: 'center',
    backgroundColor: 'rgba(241,242,249,0.9)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pillGreen: {
    backgroundColor: 'rgba(16,185,129,0.12)',
  },
  pillText: {
    color: mobileInk.muted,
    fontSize: 11,
    fontWeight: '900',
  },
  pillTextGreen: {
    color: '#10b981',
  },
  refreshButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(236,254,255,0.9)',
    borderColor: 'rgba(103,232,249,0.5)',
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  scheduleName: {
    color: mobileInk.strong,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 24,
  },
  schedulePreview: {
    color: mobileInk.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  sectionCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  sectionIcon: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  sectionSubtitle: {
    color: mobileInk.soft,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  sectionTitle: {
    color: mobileInk.strong,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  stack: {
    gap: 12,
  },
  titleCopy: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  toggleButton: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    overflow: 'hidden',
    paddingHorizontal: 16,
  },
  togglePrimary: {},
  toggleSecondary: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderWidth: 1,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '900',
  },
  toggleTextPrimary: {
    color: '#ffffff',
  },
  toggleTextSecondary: {
    color: mobileInk.muted,
  },
});
