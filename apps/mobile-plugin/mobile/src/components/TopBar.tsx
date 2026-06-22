import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildReturnToChatAction } from '../navigation';
import { MobileIcon } from './MobileIcon';

interface TopBarProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly connected?: boolean;
  readonly showChatAction?: boolean;
}

export function TopBar({ title, subtitle, connected, showChatAction = true }: TopBarProps) {
  const action = buildReturnToChatAction();
  return (
    <View style={styles.bar}>
      <View style={[styles.statusDot, connected ? styles.statusConnected : styles.statusWaiting]} />
      <View style={styles.titleGroup}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {showChatAction ? (
        <Link href={action.href} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
            style={styles.action}
          >
            <MobileIcon name={action.icon} size={17} strokeWidth={2.4} color="#db2777" />
            <Text style={styles.actionLabel}>{action.label}</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dfe4f0',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
    shadowColor: '#0f172a',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
  },
  actionLabel: {
    color: '#db2777',
    fontSize: 13,
    fontWeight: '900',
  },
  bar: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomColor: '#dfe4f0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 20,
  },
  statusConnected: {
    backgroundColor: '#10b981',
  },
  statusDot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  statusWaiting: {
    backgroundColor: '#f59e0b',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 1,
  },
  title: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '800',
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
});
