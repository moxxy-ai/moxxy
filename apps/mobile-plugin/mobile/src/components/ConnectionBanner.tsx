import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { buildConnectionBannerUi } from '../connectionBannerUi';
import { MobileIcon } from './MobileIcon';

interface ConnectionBannerProps {
  readonly paired: boolean;
  readonly connected: boolean;
  readonly status: string;
}

export function ConnectionBanner({ paired, connected, status }: ConnectionBannerProps) {
  if (paired && connected) return null;

  const ui = buildConnectionBannerUi({ paired, status });

  return (
    <View className="rounded-card border border-primary/40 bg-white px-4 py-4 shadow-card">
      <View className="flex-row items-start gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-pill bg-primarySoft">
          <MobileIcon name={ui.icon} size={20} strokeWidth={2.5} color="#db2777" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-black text-text">{ui.title}</Text>
          <Text className="mt-1 text-[12px] leading-5 text-muted">{ui.body}</Text>
        </View>
        <Link href="/settings" asChild>
          <Pressable
            accessibilityLabel={ui.actionLabel}
            accessibilityRole="button"
            className="min-h-10 justify-center rounded-block bg-primary px-3"
          >
            <Text className="text-[12px] font-black text-white">Settings</Text>
          </Pressable>
        </Link>
      </View>
      <View className="mt-3 rounded-block border border-cardBorder bg-pageBg px-3 py-2">
        {ui.steps.map((step, index) => (
          <View key={step} className="flex-row gap-2 py-1">
            <Text className="w-5 text-[12px] font-black text-primary">{index + 1}.</Text>
            <Text className="min-w-0 flex-1 text-[12px] leading-5 text-text">{step}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
