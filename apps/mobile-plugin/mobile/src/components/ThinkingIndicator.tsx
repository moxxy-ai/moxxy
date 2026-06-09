import { Animated, Text, View } from 'react-native';
import { useThinkingDots } from '@/hooks/useThinkingDots';
import { MobileIcon } from './MobileIcon';

export function ThinkingIndicator() {
  const dotOpacity = useThinkingDots();

  return (
    <View
      accessibilityLabel="Assistant is thinking"
      style={{ alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 10 }}
      testID="mobile-thinking-indicator"
    >
      <View
        className="bg-primarySoft"
        style={{ alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', width: 34 }}
      >
        <MobileIcon name="message" size={18} strokeWidth={2.35} color="#db2777" />
      </View>
      <View
        className="rounded-block border border-cardBorder bg-cardBg"
        style={{
          alignItems: 'center',
          borderRadius: 10,
          borderWidth: 1,
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <Text className="text-[13px] font-bold text-muted">Thinking</Text>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {dotOpacity.map((opacity, index) => (
            <Animated.View
              key={index}
              style={{
                backgroundColor: '#ec4899',
                borderRadius: 999,
                height: 5,
                opacity,
                width: 5,
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
