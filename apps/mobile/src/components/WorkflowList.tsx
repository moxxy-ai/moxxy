import { StyleSheet, Text, View } from 'react-native';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import type { MobileWorkflow } from '../hooks/useWorkflows';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
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
        <Gradient preset="brand" radius={11} style={styles.sectionIcon}>
          <MobileIcon name="workflows" size={17} strokeWidth={2.3} color="#ffffff" />
        </Gradient>
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>Workflows</Text>
          <Text style={styles.sectionSubtitle}>
            {workflows.length === 0 ? 'No saved automations' : `${workflows.length} saved automation${workflows.length === 1 ? '' : 's'}`}
          </Text>
        </View>
        <PressableScale style={styles.refreshButton} scaleTo={0.94} onPress={onRefresh} accessibilityRole="button">
          <MobileIcon name="actions" size={18} strokeWidth={2.4} color="#db2777" />
        </PressableScale>
      </View>

      {workflows.length === 0 ? (
        <Appear from="up" distance={12}>
          <View style={styles.emptyCard}>
            <Gradient preset="brand" radius={18} style={styles.emptyBadge}>
              <MobileIcon name="workflows" size={26} strokeWidth={2.3} color="#ffffff" />
            </Gradient>
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
              color={workflow.enabled ? '#10b981' : '#cbd2e1'}
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
            <Gradient preset="cta" radius={999} style={StyleSheet.absoluteFill} />
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
    backgroundColor: 'rgba(241,242,249,0.9)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  badgeGreen: {
    backgroundColor: 'rgba(16,185,129,0.12)',
  },
  badgeText: {
    color: mobileInk.muted,
    fontSize: 11,
    fontWeight: '900',
  },
  badgeTextGreen: {
    color: '#10b981',
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
  refreshButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(253,242,248,0.9)',
    borderColor: 'rgba(249,168,212,0.55)',
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  runButton: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 44,
    overflow: 'hidden',
    paddingHorizontal: 16,
  },
  runText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
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
  workflowDescription: {
    color: mobileInk.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  workflowName: {
    color: mobileInk.strong,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 24,
  },
});
