import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import { buildReturnToChatAction } from '../navigation';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { PressableScale, PulseDot } from './primitives/motion';

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
      <Gradient
        pointerEventsNone
        direction="vertical"
        stops={[
          { offset: 0, color: mobileGlass.chrome.sheen },
          { offset: 1, color: 'rgba(255,255,255,0)' },
        ]}
        style={styles.sheen}
      />
      <PulseDot color={connected ? '#10b981' : '#f59e0b'} size={9} pulsing={Boolean(connected)} />
      <View style={styles.titleGroup}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {showChatAction ? (
        <Link href={action.href} asChild>
          <PressableScale accessibilityRole="button" accessibilityLabel="Back to chat" scaleTo={0.94} style={styles.action}>
            <MobileIcon name={action.icon} size={17} strokeWidth={2.4} color="#db2777" />
            <Text style={styles.actionLabel}>{action.label}</Text>
          </PressableScale>
        </Link>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    backgroundColor: '#fdf2f8',
    borderColor: 'rgba(249,168,212,0.6)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
  },
  actionLabel: {
    color: '#db2777',
    fontSize: 13,
    fontWeight: '900',
  },
  bar: {
    alignItems: 'center',
    backgroundColor: mobileGlass.chrome.fill,
    borderBottomColor: mobileGlass.chrome.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 20,
    ...mobileElevation.sm,
  },
  sheen: {
    height: 24,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  subtitle: {
    color: mobileInk.soft,
    fontSize: 12,
    marginTop: 1,
  },
  title: {
    color: mobileInk.strong,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
});
