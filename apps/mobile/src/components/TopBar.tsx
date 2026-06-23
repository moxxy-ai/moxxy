import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { mobileInk, mobileSurface } from '../styles/tokens';
import { buildReturnToChatAction } from '../navigation';
import { MobileIcon } from './MobileIcon';
import { PressableScale } from './primitives/motion';

interface TopBarProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly connected?: boolean;
  readonly showChatAction?: boolean;
}

/**
 * An integrated large-title header — no chrome bar, divider or shadow. The title
 * sits directly on the page background (the AppShell mesh) like a modern iOS
 * large title, with a single refined action on the right. Shared by every
 * ScreenFrame screen so they all read as one calm, deliberate app.
 */
export function TopBar({ title, subtitle, showChatAction = true }: TopBarProps) {
  const action = buildReturnToChatAction();
  return (
    <View style={styles.bar}>
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
          <PressableScale accessibilityRole="button" accessibilityLabel="Back to chat" scaleTo={0.93} style={styles.action}>
            <MobileIcon name={action.icon} size={16} strokeWidth={2.4} color={mobileSurface.accentStrong} />
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
    alignSelf: 'flex-start',
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 38,
    paddingHorizontal: 14,
  },
  actionLabel: {
    color: mobileSurface.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  bar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingBottom: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  subtitle: {
    color: mobileInk.soft,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  title: {
    color: mobileInk.strong,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 34,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
});
