import { StyleSheet, Text, View } from 'react-native';
import { mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { Appear, PressableScale } from './primitives/motion';

interface ChatFloatingControlsProps {
  readonly title: string;
  readonly pendingActions: number;
  readonly onToggleMenu: () => void;
  readonly onRenameSession: () => void;
  readonly onOpenActions: () => void;
  readonly actionsDisabled?: boolean;
  readonly renameDisabled?: boolean;
}

/**
 * Immersive-chat chrome: no header bar, just small minimal FABs floating over
 * the panel — menu (left, with the pending badge) and rename + session actions
 * (right) — with the session name centered between them. The container is
 * `pointerEvents="box-none"` so the chat scrolls/taps through the gaps.
 */
export function ChatFloatingControls({
  title,
  pendingActions,
  onToggleMenu,
  onRenameSession,
  onOpenActions,
  actionsDisabled = false,
  renameDisabled = false,
}: ChatFloatingControlsProps) {
  return (
    <View pointerEvents="box-none" style={styles.container}>
      <PressableScale
        accessible
        accessibilityRole="button"
        accessibilityLabel="Open mobile menu"
        testID="mobile-chat-open-menu"
        hitSlop={8}
        scaleTo={0.9}
        style={styles.fab}
        onPress={onToggleMenu}
      >
        <MobileIcon name="menu" size={21} strokeWidth={2.4} color={mobileInk.strong} />
        {pendingActions > 0 ? (
          <Appear from="scale" style={styles.badge}>
            <Text style={styles.badgeText}>{pendingActions}</Text>
          </Appear>
        ) : null}
      </PressableScale>

      <View pointerEvents="none" style={styles.titleWrap}>
        <View style={styles.titlePill}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      <View style={styles.rightCluster}>
        <PressableScale
          accessible
          accessibilityRole="button"
          accessibilityLabel="Rename session"
          accessibilityState={{ disabled: renameDisabled }}
          testID="mobile-chat-rename-session"
          hitSlop={8}
          disabled={renameDisabled}
          scaleTo={0.9}
          style={styles.fab}
          onPress={onRenameSession}
        >
          <MobileIcon name="edit" size={19} strokeWidth={2.3} color={renameDisabled ? mobileInk.faint : mobileInk.strong} />
        </PressableScale>
        <PressableScale
          accessible
          accessibilityRole="button"
          accessibilityLabel="Open session actions"
          accessibilityState={{ disabled: actionsDisabled }}
          testID="mobile-chat-open-session-actions"
          hitSlop={8}
          disabled={actionsDisabled}
          scaleTo={0.9}
          style={styles.fab}
          onPress={onOpenActions}
        >
          <MobileIcon name="more" size={21} strokeWidth={2.7} color={actionsDisabled ? mobileInk.faint : mobileInk.strong} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accent,
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 2,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 4,
    paddingVertical: 1,
    position: 'absolute',
    right: -4,
    top: -4,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    left: 0,
    paddingHorizontal: 14,
    position: 'absolute',
    right: 0,
    top: 8,
    zIndex: 30,
  },
  fab: {
    alignItems: 'center',
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
    ...mobileFlat.card,
  },
  rightCluster: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  title: {
    color: mobileInk.strong,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  titlePill: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 7,
    ...mobileFlat.card,
  },
  titleWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
});
