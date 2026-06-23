import { Pressable, Text, View } from 'react-native';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { IconButton } from '@/ui/kit';

interface ChatHeaderProps {
  readonly title: string;
  readonly subtitle: string;
  readonly connected: boolean;
  readonly pendingActions: number;
  readonly onMenu: () => void;
  readonly onNewChat: () => void;
  readonly onTitlePress: () => void;
  readonly onTitleLongPress: () => void;
  readonly newChatDisabled?: boolean;
  readonly titleDisabled?: boolean;
}

export function ChatHeader({
  title,
  subtitle,
  connected,
  pendingActions,
  onMenu,
  onNewChat,
  onTitlePress,
  onTitleLongPress,
  newChatDisabled = false,
  titleDisabled = false,
}: ChatHeaderProps) {
  const { colors } = useTheme();
  return (
    <View
      style={sx('flex-row items-center border-b border-cardBorder px-2', {
        backgroundColor: colors.appBg,
        gap: 6,
        minHeight: 64,
        paddingVertical: 8,
      })}
    >
      <IconButton
        icon="menu"
        variant="ghost"
        accessibilityLabel="Open menu"
        onPress={onMenu}
        badge={pendingActions}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. Tap for session actions, long press to rename.`}
        accessibilityState={{ disabled: titleDisabled }}
        disabled={titleDisabled}
        onPress={onTitlePress}
        onLongPress={onTitleLongPress}
        style={sx('flex-1 items-center justify-center', { minWidth: 0 })}
      >
        <Text style={sx('text-[15px] font-bold text-text text-center')} numberOfLines={1}>
          {title}
        </Text>
        <View style={sx('mt-0.5 flex-row items-center justify-center', { gap: 5, maxWidth: '100%' })}>
          <View
            style={sx('rounded-full', {
              backgroundColor: connected ? colors.green : colors.amber,
              height: 6,
              width: 6,
            })}
          />
          <Text style={sx('text-[12px] font-medium text-dim text-center')} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </Pressable>

      <IconButton
        icon="plus"
        variant="ghost"
        accessibilityLabel="New chat"
        onPress={onNewChat}
        disabled={newChatDisabled}
      />
    </View>
  );
}
