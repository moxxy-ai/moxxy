import { StyleSheet, Text, View } from 'react-native';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import { textOf } from '@/utils/record';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
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
        <Gradient
          preset={connected ? 'brand' : 'cta'}
          radius={12}
          style={styles.headerIcon}
          stops={
            connected
              ? undefined
              : [
                  { offset: 0, color: '#fbbf24' },
                  { offset: 1, color: '#f59e0b' },
                ]
          }
        >
          <MobileIcon name="agent" size={20} strokeWidth={2.3} color="#ffffff" />
        </Gradient>
        <View style={styles.headerCopy}>
          <View style={styles.statusRow}>
            <PulseDot color={connected ? '#10b981' : '#f59e0b'} size={9} pulsing={connected} />
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
    backgroundColor: mobileGlass.card.fill,
    borderColor: mobileGlass.card.border,
    borderRadius: 22,
    borderTopColor: mobileGlass.card.hairline,
    borderWidth: 1,
    padding: 16,
    ...mobileElevation.md,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerIcon: {
    alignItems: 'center',
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
    backgroundColor: '#fce7f3',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pillText: {
    color: '#be185d',
    fontSize: 11,
    fontWeight: '800',
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
    fontWeight: '900',
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
    fontWeight: '800',
  },
});
