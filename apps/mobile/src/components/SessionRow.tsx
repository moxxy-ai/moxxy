import { StyleSheet, Text, View } from 'react-native';
import { mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import { boolOf, recordId, textOf } from '@/utils/record';
import { buildSessionRowAccessibility } from '@/sessionRowUi';
import { PressableScale, PulseDot } from './primitives/motion';

interface SessionRowProps {
  readonly workspace: Record<string, unknown>;
  readonly active: boolean;
  readonly onPress: (id: string) => void;
}

export function SessionRow({ workspace, active, onPress }: SessionRowProps) {
  const id = recordId(workspace, '');
  const name = textOf(workspace.firstPrompt, textOf(workspace.name, textOf(workspace.label, 'Workspace')));
  const cwd = textOf(workspace.cwd, textOf(workspace.path, ''));
  const unread = boolOf(workspace.unread);
  const live = boolOf(workspace.live);
  const readOnly = boolOf(workspace.readOnly);
  const eventCount = typeof workspace.eventCount === 'number' ? workspace.eventCount : null;
  const lastActivity = textOf(workspace.lastActivity);
  const accessibility = buildSessionRowAccessibility(workspace);

  const dotColor = unread ? mobileSurface.accent : active || live ? '#16a34a' : '#cbd2e1';

  return (
    <PressableScale
      accessibilityLabel={accessibility.accessibilityLabel}
      accessibilityRole={accessibility.accessibilityRole}
      scaleTo={0.985}
      style={[styles.card, active ? styles.cardActive : null]}
      onPress={() => id && onPress(id)}
    >
      <View style={styles.row}>
        <PulseDot color={dotColor} size={10} pulsing={active || live} style={styles.dot} />
        <View style={styles.body}>
          <Text style={[styles.name, active ? styles.nameActive : null]}>{name}</Text>
          {cwd ? (
            <Text style={styles.cwd} numberOfLines={1}>
              {cwd}
            </Text>
          ) : null}
          <View style={styles.badges}>
            {eventCount !== null ? <Badge label={`${eventCount} events`} /> : null}
            {lastActivity ? <Badge label={formatDate(lastActivity)} /> : null}
            {live ? <Badge label="Live" active /> : null}
            {readOnly ? <Badge label="Archive" /> : null}
          </View>
        </View>
        {active ? (
          <View style={styles.activeTag}>
            <Text style={styles.activeTagText}>Active</Text>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

function Badge({ label, active }: { readonly label: string; readonly active?: boolean }) {
  return (
    <View style={[styles.badge, active ? styles.badgeActive : null]}>
      <Text style={[styles.badgeText, active ? styles.badgeTextActive : null]}>{label}</Text>
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  });
}

const styles = StyleSheet.create({
  activeTag: {
    backgroundColor: mobileSurface.accent,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  activeTagText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  badge: {
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeActive: {
    backgroundColor: '#ecfdf5',
    borderColor: '#bbf7d0',
  },
  badgeText: {
    color: mobileInk.soft,
    fontSize: 10,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: '#16a34a',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...mobileFlat.card,
  },
  cardActive: {
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
  },
  cwd: {
    color: mobileInk.soft,
    fontSize: 12,
    marginTop: 2,
  },
  dot: {
    marginTop: 4,
  },
  name: {
    color: mobileInk.strong,
    fontSize: 15,
    fontWeight: '700',
  },
  nameActive: {
    color: mobileSurface.accentStrong,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
});
