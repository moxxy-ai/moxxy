import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MobileIcon } from './MobileIcon';

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
    <View
      style={styles.header}
    >
      {showMenuButton ? (
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Open mobile menu"
          testID="mobile-chat-open-menu"
          hitSlop={8}
          style={styles.menuButton}
          onPress={onToggleMenu}
        >
          <MobileIcon name="menu" size={21} strokeWidth={2.4} color="#475569" />
          {pendingActions > 0 ? (
            <View
              style={styles.pendingBadge}
            >
              <Text style={styles.pendingBadgeText}>{pendingActions}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}

        <View style={styles.titleColumn}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, connected ? styles.statusDotConnected : styles.statusDotDisconnected]} />
            <Text style={styles.statusLabel} numberOfLines={1}>
              {statusLabel}
            </Text>
          </View>
        </View>

      {showSessionActions ? (
        <View style={styles.actions}>
          <Pressable
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
            <MobileIcon name="edit" size={20} strokeWidth={2.3} color={renameDisabled ? '#94a3b8' : '#475569'} />
          </Pressable>
          <Pressable
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
            <MobileIcon name="more" size={21} strokeWidth={2.7} color={actionsDisabled ? '#94a3b8' : '#475569'} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#fcfcff',
    borderBottomColor: '#e3e5f0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    height: 64,
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 30,
  },
  menuButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e3e5f0',
    borderRadius: 14,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    width: 44,
  },
  pendingBadge: {
    alignItems: 'center',
    backgroundColor: '#ef4444',
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 2,
    minWidth: 22,
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
  statusDot: {
    borderRadius: 999,
    height: 9,
    width: 9,
  },
  statusDotConnected: {
    backgroundColor: '#10b981',
  },
  statusDotDisconnected: {
    backgroundColor: '#f59e0b',
  },
  statusLabel: {
    color: '#667085',
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginTop: 1,
  },
  title: {
    color: '#0f172a',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 23,
  },
  titleColumn: {
    flex: 1,
    minWidth: 0,
  },
});
