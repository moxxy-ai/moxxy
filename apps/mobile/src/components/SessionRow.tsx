import { StyleSheet, Text, View } from 'react-native';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
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

  const dotColor = unread ? '#db2777' : active || live ? '#10b981' : '#cbd2e1';

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
          <Text style={styles.name}>{name}</Text>
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
    backgroundColor: '#db2777',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  activeTagText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  badge: {
    backgroundColor: 'rgba(241,242,249,0.9)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeActive: {
    backgroundColor: '#10b981',
  },
  badgeText: {
    color: mobileInk.soft,
    fontSize: 10,
    fontWeight: '800',
  },
  badgeTextActive: {
    color: '#ffffff',
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
    backgroundColor: mobileGlass.card.fill,
    borderColor: mobileGlass.card.border,
    borderRadius: 20,
    borderTopColor: mobileGlass.card.hairline,
    borderWidth: 1,
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...mobileElevation.md,
  },
  cardActive: {
    backgroundColor: '#fdf2f8',
    borderColor: '#db2777',
    borderTopColor: '#f9a8d4',
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
    fontWeight: '800',
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
});
