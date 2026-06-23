import { StyleSheet, Text, View } from 'react-native';
import { mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import type { MobileWorkflow } from '../hooks/useWorkflows';
import { MobileIcon } from './MobileIcon';
import { Appear, PressableScale, PulseDot } from './primitives/motion';

interface WorkflowListProps {
  readonly workflows: ReadonlyArray<MobileWorkflow>;
  readonly onRefresh: () => void;
  readonly onRun: (name: string) => void;
}

export function WorkflowList({ workflows, onRefresh, onRun }: WorkflowListProps) {
  return (
    <View style={styles.stack}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>Workflows</Text>
          <Text style={styles.sectionSubtitle}>
            {workflows.length === 0 ? 'No saved automations' : `${workflows.length} saved automation${workflows.length === 1 ? '' : 's'}`}
          </Text>
        </View>
        <PressableScale style={styles.refreshButton} scaleTo={0.94} onPress={onRefresh} accessibilityRole="button">
          <MobileIcon name="actions" size={18} strokeWidth={2.4} color={mobileInk.muted} />
        </PressableScale>
      </View>

      {workflows.length === 0 ? (
        <Appear from="up" distance={12}>
          <View style={styles.emptyCard}>
            <View style={styles.emptyBadge}>
              <MobileIcon name="workflows" size={24} strokeWidth={2.3} color={mobileSurface.accentStrong} />
            </View>
            <Text style={styles.emptyTitle}>No workflows visible</Text>
            <Text style={styles.emptyBody}>
              Start Moxxy with the workflows plugin enabled, then refresh this list.
            </Text>
          </View>
        </Appear>
      ) : null}

      {workflows.map((workflow) => (
        <View key={workflow.name} style={styles.card}>
          <View style={styles.cardRow}>
            <PulseDot
              color={workflow.enabled ? '#16a34a' : '#cbd2e1'}
              size={8}
              pulsing={workflow.enabled}
              style={styles.dot}
            />
            <View style={styles.cardBody}>
              <Text style={styles.workflowName}>{workflow.name}</Text>
              {workflow.description ? (
                <Text style={styles.workflowDescription}>{workflow.description}</Text>
              ) : null}
              <View style={styles.badges}>
                <Badge label={workflow.enabled ? 'Enabled' : 'Disabled'} tone={workflow.enabled ? 'green' : 'muted'} />
                {workflow.scope ? <Badge label={workflow.scope} tone="muted" /> : null}
                <Badge label={`${workflow.steps} steps`} tone="muted" />
                {workflow.triggers ? <Badge label={workflow.triggers} tone="muted" /> : null}
              </View>
            </View>
          </View>
          <PressableScale style={styles.runButton} scaleTo={0.97} onPress={() => onRun(workflow.name)}>
            <MobileIcon name="send" size={17} strokeWidth={2.4} color="#ffffff" />
            <Text style={styles.runText}>Run workflow</Text>
          </PressableScale>
        </View>
      ))}
    </View>
  );
}

function Badge({ label, tone }: { readonly label: string; readonly tone: 'green' | 'muted' }) {
  return (
    <View style={[styles.badge, tone === 'green' ? styles.badgeGreen : null]}>
      <Text style={[styles.badgeText, tone === 'green' ? styles.badgeTextGreen : null]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeGreen: {
    backgroundColor: '#ecfdf5',
    borderColor: '#bbf7d0',
  },
  badgeText: {
    color: mobileInk.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextGreen: {
    color: '#16a34a',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  card: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    ...mobileFlat.card,
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
  dot: {
    marginTop: 6,
  },
  emptyBadge: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 16,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    marginBottom: 16,
    width: 52,
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
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    ...mobileFlat.card,
  },
  emptyTitle: {
    color: mobileInk.strong,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  refreshButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  runButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accent,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  runText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
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
  sectionSubtitle: {
    color: mobileInk.soft,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  sectionTitle: {
    color: mobileInk.strong,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  stack: {
    gap: 12,
  },
  workflowDescription: {
    color: mobileInk.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  workflowName: {
    color: mobileInk.strong,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 24,
  },
});
