import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildConnectionBannerUi } from '../connectionBannerUi';
import { MobileIcon } from './MobileIcon';

interface ConnectionBannerProps {
  readonly paired: boolean;
  readonly connected: boolean;
  readonly status: string;
}

export function ConnectionBanner({ paired, connected, status }: ConnectionBannerProps) {
  if (paired && connected) return null;

  const ui = buildConnectionBannerUi({ paired, status });

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconBadge}>
          <MobileIcon name={ui.icon} size={20} strokeWidth={2.5} color="#db2777" />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{ui.title}</Text>
          <Text style={styles.body}>{ui.body}</Text>
        </View>
      </View>
      <View style={styles.steps}>
        {ui.steps.map((step, index) => (
          <View key={step} style={styles.stepRow}>
            <Text style={styles.stepIndex}>{index + 1}.</Text>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>
      <View style={styles.actionRow}>
        <Link href="/settings" asChild>
          <Pressable
            accessibilityLabel={ui.actionLabel}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.settingsButton,
              pressed ? styles.settingsButtonPressed : null,
            ]}
          >
            <MobileIcon name="settings" size={15} strokeWidth={2.4} color="#ffffff" />
            <Text style={styles.settingsButtonText}>Open settings</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'flex-start',
    marginTop: 14,
  },
  body: {
    color: '#667085',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: 'rgba(219, 39, 119, 0.32)',
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#db2777',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: '#fce7f3',
    borderRadius: 999,
    flexShrink: 0,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  settingsButton: {
    alignItems: 'center',
    backgroundColor: '#db2777',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  settingsButtonPressed: {
    opacity: 0.78,
  },
  settingsButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  stepIndex: {
    color: '#db2777',
    fontSize: 12,
    fontWeight: '900',
    width: 22,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  stepText: {
    color: '#111827',
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    minWidth: 0,
  },
  steps: {
    backgroundColor: '#f8fafc',
    borderColor: '#e4e7ec',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  title: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 20,
  },
});
