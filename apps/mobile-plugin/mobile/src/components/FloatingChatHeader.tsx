import { Pressable, Text, View } from 'react-native';
import { MobileIcon } from './MobileIcon';

interface FloatingChatHeaderProps {
  readonly connected: boolean;
  readonly statusLabel: string;
  readonly pendingActions: number;
  readonly onToggleMenu: () => void;
  readonly onRenameSession: () => void;
  readonly onOpenActions: () => void;
  readonly actionsDisabled?: boolean;
  readonly renameDisabled?: boolean;
}

export function FloatingChatHeader({
  connected,
  statusLabel,
  pendingActions,
  onToggleMenu,
  onRenameSession,
  onOpenActions,
  actionsDisabled = false,
  renameDisabled = false,
}: FloatingChatHeaderProps) {
  return (
    <View
      className="z-30"
      style={{
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
      }}
    >
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Open mobile menu"
          testID="mobile-chat-open-menu"
          hitSlop={8}
          className="items-center justify-center rounded-block bg-cardBg"
          style={{ borderColor: '#e3e5f0', borderRadius: 10, borderWidth: 1, height: 40, width: 40 }}
          onPress={onToggleMenu}
        >
          <MobileIcon name="menu" size={21} strokeWidth={2.4} color="#475569" />
          {pendingActions > 0 ? (
            <View
              className="items-center rounded-pill bg-red"
              style={{
                minWidth: 20,
                paddingHorizontal: 5,
                paddingVertical: 1,
                position: 'absolute',
                right: -4,
                top: -4,
              }}
            >
              <Text className="text-[10px] font-black text-white">{pendingActions}</Text>
            </View>
          ) : null}
        </Pressable>

        <View
          style={{ flex: 1, minWidth: 0 }}
        >
          <Text className="text-[18px] font-bold text-text">Chat</Text>
          <View className="flex-row items-center gap-2">
            <View className={`h-2.5 w-2.5 rounded-pill ${connected ? 'bg-green' : 'bg-amber'}`} />
            <Text className="text-[12px] font-bold text-muted" numberOfLines={1}>
              {statusLabel}
            </Text>
          </View>
        </View>

        <View
          style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}
        >
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Rename session"
            testID="mobile-chat-rename-session"
            hitSlop={8}
            className="items-center justify-center rounded-block"
            disabled={renameDisabled}
            style={{ borderRadius: 9, height: 36, opacity: renameDisabled ? 0.42 : 1, width: 36 }}
            onPress={onRenameSession}
          >
            <MobileIcon name="edit" size={19} strokeWidth={2.3} color="#475569" />
          </Pressable>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Open session actions"
            testID="mobile-chat-open-session-actions"
            hitSlop={8}
            className="items-center justify-center rounded-block"
            disabled={actionsDisabled}
            style={{ borderRadius: 9, height: 36, opacity: actionsDisabled ? 0.42 : 1, width: 36 }}
            onPress={onOpenActions}
          >
            <MobileIcon name="more" size={20} strokeWidth={2.7} color="#475569" />
          </Pressable>
        </View>
    </View>
  );
}
