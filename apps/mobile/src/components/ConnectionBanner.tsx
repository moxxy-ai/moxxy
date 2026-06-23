import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import { buildConnectionBannerUi } from '../connectionBannerUi';
import { MobileIcon } from './MobileIcon';
import { PressableScale } from './primitives/motion';

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
          <MobileIcon name={ui.icon} size={20} strokeWidth={2.5} color={mobileSurface.accentStrong} />
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
          <PressableScale accessibilityLabel={ui.actionLabel} accessibilityRole="button" scaleTo={0.95} style={styles.settingsButton}>
            <MobileIcon name="settings" size={15} strokeWidth={2.4} color="#ffffff" />
            <Text style={styles.settingsButtonText}>Open settings</Text>
          </PressableScale>
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
    color: mobileInk.soft,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  card: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    ...mobileFlat.card,
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
    backgroundColor: mobileSurface.accentSoft,
    borderRadius: 999,
    flexShrink: 0,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  settingsButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accent,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  settingsButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  stepIndex: {
    color: mobileSurface.accentStrong,
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
    color: mobileInk.strong,
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    minWidth: 0,
  },
  steps: {
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  title: {
    color: mobileInk.strong,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 20,
  },
});
