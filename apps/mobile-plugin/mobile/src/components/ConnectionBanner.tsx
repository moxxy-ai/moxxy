import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { MobileIcon } from './MobileIcon';

interface ConnectionBannerProps {
  readonly paired: boolean;
  readonly connected: boolean;
  readonly status: string;
}

export function ConnectionBanner({ paired, connected, status }: ConnectionBannerProps) {
  if (paired && connected) return null;

  const title = paired ? 'Gateway reconnecting' : 'Pair the mobile app';
  const body = paired
    ? `Socket status: ${status}. Chat and sessions will sync when the gateway responds.`
    : 'Open Settings to pair this device with the Mobile Gateway.';

  return (
    <View className="flex-row items-center gap-3 rounded-card border border-cardBorder bg-cardBg px-4 py-3 shadow-card">
      <View className="h-10 w-10 items-center justify-center rounded-pill bg-primarySoft">
        <MobileIcon name={paired ? 'wifi' : 'wifiOff'} size={19} strokeWidth={2.5} color="#db2777" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-bold text-text">{title}</Text>
        <Text className="mt-0.5 text-[12px] leading-4 text-muted">{body}</Text>
      </View>
      <Link href="/settings" asChild>
        <Pressable
          accessibilityLabel="Open settings"
          accessibilityRole="button"
          className="min-h-10 justify-center rounded-block bg-primary px-3"
        >
          <Text className="text-[12px] font-black text-white">Settings</Text>
        </Pressable>
      </Link>
    </View>
  );
}
