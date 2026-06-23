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
  readonly onRename: () => void;
  readonly renameDisabled?: boolean;
  /** Tap the connection status row (dot + subtitle) to open the connection
   *  sheet — the always-reachable reconnect / settings surface. */
  readonly onStatusPress?: () => void;
}

export function ChatHeader({
  title,
  subtitle,
  connected,
  pendingActions,
  onMenu,
  onRename,
  renameDisabled = false,
  onStatusPress,
}: ChatHeaderProps) {
  const { colors } = useTheme();
  return (
    <View
      style={sx('flex-row items-center border-b border-cardBorder px-2', {
        backgroundColor: colors.appBg,
        gap: 4,
        minHeight: 64,
        paddingVertical: 8,
      })}
    >
      <IconButton icon="menu" variant="ghost" accessibilityLabel="Open menu" onPress={onMenu} badge={pendingActions} />

      <View style={sx('flex-1 pl-1', { minWidth: 0 })}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}. Tap to rename this chat.`}
          accessibilityState={{ disabled: renameDisabled }}
          disabled={renameDisabled}
          onPress={onRename}
        >
          <Text style={sx('text-[16px] font-bold text-text')} numberOfLines={1}>
            {title}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Connection: ${subtitle}. Tap to manage the connection.`}
          disabled={!onStatusPress}
          hitSlop={8}
          onPress={onStatusPress}
          style={sx('mt-0.5 flex-row items-center self-start', { gap: 6 })}
        >
          <View
            style={sx('rounded-full', {
              backgroundColor: connected ? colors.green : colors.amber,
              height: 6,
              width: 6,
            })}
          />
          <Text style={sx('text-[13px] font-medium text-dim')} numberOfLines={1}>
            {subtitle}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
