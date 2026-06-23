import { sx } from '../styles/tokens';
import { Animated, Text, View } from 'react-native';
import { useThinkingDots } from '@/hooks/useThinkingDots';
import { useTheme } from '@/theme/ThemeProvider';
import { MobileIcon } from './MobileIcon';

export function ThinkingIndicator() {
  const { colors } = useTheme();
  const dotOpacity = useThinkingDots();

  return (
    <View
      accessibilityLabel="Assistant is thinking"
      style={{ alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 10 }}
      testID="mobile-thinking-indicator"
    >
      <View
        style={sx('bg-primarySoft', { alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', width: 34 })}
      >
        <MobileIcon name="message" size={18} strokeWidth={2.35} color={colors.primaryStrong} />
      </View>
      <View
        style={sx('rounded-block border border-cardBorder bg-cardBg', {
          alignItems: 'center',
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
        })}
      >
        <Text style={sx('text-[13px] font-bold text-muted')}>Thinking</Text>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {dotOpacity.map((opacity, index) => (
            <Animated.View
              key={index}
              style={{
                backgroundColor: colors.primary,
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
