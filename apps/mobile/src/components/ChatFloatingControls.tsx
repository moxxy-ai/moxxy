import { StyleSheet, Text, View } from 'react-native';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { Appear, PressableScale } from './primitives/motion';

interface ChatFloatingControlsProps {
  readonly pendingActions: number;
  readonly onToggleMenu: () => void;
  readonly onRenameSession: () => void;
  readonly onOpenActions: () => void;
  readonly actionsDisabled?: boolean;
  readonly renameDisabled?: boolean;
}

/**
 * Immersive-chat chrome: instead of a full header bar, a few small glass FABs
 * float over the corners of the chat panel — menu on the left (opens the nav
 * drawer), rename + session actions on the right. The container is
 * `pointerEvents="box-none"` so the chat scrolls and receives touches through
 * the gap between the clusters; only the buttons themselves capture input.
 */
export function ChatFloatingControls({
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
        <MobileIcon name="menu" size={21} strokeWidth={2.4} color={mobileInk.muted} />
        {pendingActions > 0 ? (
          <Appear from="scale" style={styles.badge}>
            <Gradient preset="cta" radius={999} style={StyleSheet.absoluteFill} />
            <Text style={styles.badgeText}>{pendingActions}</Text>
          </Appear>
        ) : null}
      </PressableScale>

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
          <MobileIcon name="edit" size={19} strokeWidth={2.3} color={renameDisabled ? mobileInk.faint : mobileInk.muted} />
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
          <MobileIcon name="more" size={21} strokeWidth={2.7} color={actionsDisabled ? mobileInk.faint : mobileInk.muted} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 2,
    justifyContent: 'center',
    minWidth: 20,
    overflow: 'hidden',
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
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 14,
    position: 'absolute',
    right: 0,
    top: 8,
    zIndex: 30,
  },
  fab: {
    alignItems: 'center',
    backgroundColor: mobileGlass.chrome.fill,
    borderColor: mobileGlass.chrome.hairline,
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
    ...mobileElevation.sm,
  },
  rightCluster: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
});
