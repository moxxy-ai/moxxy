import { Text, View } from 'react-native';
import { MobileIcon, type MobileIconName } from './MobileIcon';

interface SessionLoadingNoticeProps {
  readonly title: string;
  readonly body: string;
  readonly icon?: MobileIconName;
}

export function SessionLoadingNotice({
  title,
  body,
  icon = 'agent',
}: SessionLoadingNoticeProps) {
  return (
    <View className="rounded-block border border-cardBorder bg-cardBg px-5 py-5 shadow-card" style={{ shadowOpacity: 0.1 }}>
      <View className="flex-row items-start gap-4">
        <View className="h-11 w-11 items-center justify-center rounded-block bg-primarySoft">
          <MobileIcon name={icon} size={23} strokeWidth={2.35} color="#db2777" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[18px] font-black text-text">{title}</Text>
          <Text className="mt-1 text-[14px] font-semibold leading-5 text-muted">{body}</Text>
        </View>
      </View>
    </View>
  );
}
