import { StyleSheet, Text, View } from 'react-native';
import { mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import { textOf } from '@/utils/record';
import { MobileIcon } from './MobileIcon';
import { PulseDot } from './primitives/motion';

interface SessionHeaderProps {
  readonly connected: boolean;
  readonly session: Record<string, unknown> | null;
  readonly agents: ReadonlyArray<Record<string, unknown>>;
  readonly activeMode?: string | null;
  readonly activeProvider?: string | null;
}

export function SessionHeader({
  connected,
  session,
  agents,
  activeMode,
  activeProvider,
}: SessionHeaderProps) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <MobileIcon name="agent" size={20} strokeWidth={2.3} color={mobileSurface.accentStrong} />
        </View>
        <View style={styles.headerCopy}>
          <View style={styles.statusRow}>
            <PulseDot color={connected ? '#16a34a' : '#d97706'} size={9} pulsing={connected} />
            <Text style={styles.statusText}>{connected ? 'Connected' : 'Waiting for gateway'}</Text>
          </View>
          <Text style={styles.sessionId} numberOfLines={1}>
            {textOf(session?.id, 'No active session')}
          </Text>
        </View>
      </View>
      <View style={styles.pills}>
        <Pill label={activeProvider ?? 'Provider'} />
        <Pill label={activeMode ?? 'Mode'} />
        <Pill label={`${agents.length} agent${agents.length === 1 ? '' : 's'}`} />
      </View>
    </View>
  );
}

function Pill({ label }: { readonly label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    ...mobileFlat.card,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerIcon: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexShrink: 0,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  pill: {
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pillText: {
    color: mobileInk.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  sessionId: {
    color: mobileInk.strong,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 3,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  statusText: {
    color: mobileInk.muted,
    fontSize: 13,
    fontWeight: '700',
  },
});
