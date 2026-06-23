import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import { buildReturnToChatAction } from '../navigation';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { PressableScale } from './primitives/motion';

interface TopBarProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly connected?: boolean;
  readonly showChatAction?: boolean;
}

export function TopBar({ title, subtitle, showChatAction = true }: TopBarProps) {
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
      <View style={styles.titleGroup}>
        <View style={styles.titleRow}>
          <View style={styles.accent} />
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {showChatAction ? (
        <Link href={action.href} asChild>
          <PressableScale accessibilityRole="button" accessibilityLabel="Back to chat" scaleTo={0.94} style={styles.action}>
            <MobileIcon name={action.icon} size={16} strokeWidth={2.4} color="#db2777" />
            <Text style={styles.actionLabel}>{action.label}</Text>
          </PressableScale>
        </Link>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  accent: {
    backgroundColor: '#ec4899',
    borderRadius: 999,
    height: 22,
    width: 4,
  },
  action: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#fdf2f8',
    borderColor: 'rgba(249,168,212,0.6)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 2,
    minHeight: 38,
    paddingHorizontal: 14,
  },
  actionLabel: {
    color: '#db2777',
    fontSize: 13,
    fontWeight: '900',
  },
  bar: {
    alignItems: 'flex-start',
    backgroundColor: mobileGlass.chrome.fill,
    borderBottomColor: mobileGlass.chrome.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 20,
    paddingTop: 10,
    ...mobileElevation.sm,
  },
  sheen: {
    height: 22,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  subtitle: {
    color: mobileInk.soft,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 12,
    marginTop: 3,
  },
  title: {
    color: mobileInk.strong,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
});
