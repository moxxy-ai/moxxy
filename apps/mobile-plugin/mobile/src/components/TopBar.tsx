import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { buildReturnToChatAction } from '../navigation';
import { MobileIcon } from './MobileIcon';

interface TopBarProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly connected?: boolean;
  readonly showChatAction?: boolean;
}

export function TopBar({ title, subtitle, connected, showChatAction = true }: TopBarProps) {
  const action = buildReturnToChatAction();
  return (
    <View className="min-h-16 flex-row items-center gap-3 border-b border-cardBorder bg-cardBg px-5">
      <View className={`h-2.5 w-2.5 rounded-pill ${connected ? 'bg-green' : 'bg-amber'}`} />
      <View className="min-w-0 flex-1">
        <Text className="text-[18px] font-bold text-text">{title}</Text>
        {subtitle ? <Text className="truncate text-[12px] text-muted">{subtitle}</Text> : null}
      </View>
      {showChatAction ? (
        <Link href={action.href} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
            className="min-h-10 flex-row items-center justify-center gap-2 rounded-pill border border-cardBorder bg-cardBg px-3 shadow-card"
          >
            <MobileIcon name={action.icon} size={17} strokeWidth={2.4} color="#db2777" />
            <Text className="text-[13px] font-black text-primaryStrong">{action.label}</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}
