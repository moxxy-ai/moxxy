import { StyleSheet, Text, View } from 'react-native';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { Appear, PressableScale, PulseDot } from './primitives/motion';

interface FloatingChatHeaderProps {
  readonly connected: boolean;
  readonly statusLabel: string;
  readonly pendingActions: number;
  readonly title?: string;
  readonly onToggleMenu: () => void;
  readonly onRenameSession: () => void;
  readonly onOpenActions: () => void;
  readonly actionsDisabled?: boolean;
  readonly renameDisabled?: boolean;
  readonly showMenuButton?: boolean;
  readonly showSessionActions?: boolean;
}

export function FloatingChatHeader({
  connected,
  statusLabel,
  pendingActions,
  title = 'Chat',
  onToggleMenu,
  onRenameSession,
  onOpenActions,
  actionsDisabled = false,
  renameDisabled = false,
  showMenuButton = true,
  showSessionActions = true,
}: FloatingChatHeaderProps) {
  return (
    <View style={styles.header}>
      <Gradient
        pointerEventsNone
        direction="vertical"
        stops={[
          { offset: 0, color: mobileGlass.chrome.sheen },
          { offset: 1, color: 'rgba(255,255,255,0)' },
        ]}
        style={styles.sheen}
      />
      {showMenuButton ? (
        <PressableScale
          accessible
          accessibilityRole="button"
          accessibilityLabel="Open mobile menu"
          testID="mobile-chat-open-menu"
          hitSlop={8}
          scaleTo={0.9}
          style={styles.menuButton}
          onPress={onToggleMenu}
        >
          <MobileIcon name="menu" size={21} strokeWidth={2.4} color={mobileInk.muted} />
          {pendingActions > 0 ? (
            <Appear from="scale" style={styles.pendingBadge}>
              <Gradient preset="cta" radius={999} style={StyleSheet.absoluteFill} />
              <Text style={styles.pendingBadgeText}>{pendingActions}</Text>
            </Appear>
          ) : null}
        </PressableScale>
      ) : null}

      <View style={styles.titleColumn}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.statusRow}>
          <PulseDot color={connected ? '#10b981' : '#f59e0b'} size={8} pulsing={connected} />
          <Text style={styles.statusLabel} numberOfLines={1}>
            {statusLabel}
          </Text>
        </View>
      </View>

      {showSessionActions ? (
        <View style={styles.actions}>
          <PressableScale
            accessible
            accessibilityRole="button"
            accessibilityLabel="Rename session"
            accessibilityState={{ disabled: renameDisabled }}
            testID="mobile-chat-rename-session"
            hitSlop={8}
            disabled={renameDisabled}
            style={styles.actionButton}
            onPress={onRenameSession}
          >
            <MobileIcon name="edit" size={20} strokeWidth={2.3} color={renameDisabled ? mobileInk.faint : mobileInk.muted} />
          </PressableScale>
          <PressableScale
            accessible
            accessibilityRole="button"
            accessibilityLabel="Open session actions"
            accessibilityState={{ disabled: actionsDisabled }}
            testID="mobile-chat-open-session-actions"
            hitSlop={8}
            disabled={actionsDisabled}
            style={styles.actionButton}
            onPress={onOpenActions}
          >
            <MobileIcon name="more" size={21} strokeWidth={2.7} color={actionsDisabled ? mobileInk.faint : mobileInk.muted} />
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderColor: 'rgba(226,228,240,0.7)',
    borderRadius: 13,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  header: {
    alignItems: 'center',
    backgroundColor: mobileGlass.chrome.fill,
    borderBottomColor: mobileGlass.chrome.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    height: 64,
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 30,
    ...mobileElevation.sm,
  },
  menuButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderColor: mobileGlass.chrome.hairline,
    borderRadius: 14,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
    ...mobileElevation.xs,
  },
  pendingBadge: {
    alignItems: 'center',
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 2,
    justifyContent: 'center',
    minWidth: 22,
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 1,
    position: 'absolute',
    right: -6,
    top: -6,
  },
  pendingBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
  sheen: {
    height: 28,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  statusLabel: {
    color: mobileInk.soft,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginTop: 2,
  },
  title: {
    color: mobileInk.strong,
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.3,
    lineHeight: 23,
  },
  titleColumn: {
    flex: 1,
    minWidth: 0,
  },
});
