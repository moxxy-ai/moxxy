import { mobileGlass, mobileInk } from '../styles/tokens';
import { Animated, Text, View } from 'react-native';
import { useThinkingDots } from '@/hooks/useThinkingDots';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { Appear } from './primitives/motion';

export function ThinkingIndicator() {
  const dotOpacity = useThinkingDots();

  return (
    <Appear from="up" distance={6}>
      <View
        accessibilityLabel="Assistant is thinking"
        style={{ alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 12 }}
        testID="mobile-thinking-indicator"
      >
        <Gradient
          preset="brand"
          radius={11}
          style={{ alignItems: 'center', height: 34, justifyContent: 'center', width: 34 }}
        >
          <MobileIcon name="message" size={18} strokeWidth={2.4} color="#ffffff" />
        </Gradient>
        <View
          style={{
            alignItems: 'center',
            backgroundColor: mobileGlass.card.fill,
            borderColor: mobileGlass.card.border,
            borderRadius: 14,
            borderTopColor: mobileGlass.card.hairline,
            borderWidth: 1,
            flexDirection: 'row',
            gap: 9,
            paddingHorizontal: 13,
            paddingVertical: 9,
          }}
        >
          <Text style={{ color: mobileInk.muted, fontSize: 13, fontWeight: '700' }}>Thinking</Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {dotOpacity.map((opacity, index) => (
              <Animated.View
                key={index}
                style={{
                  backgroundColor: '#ec4899',
                  borderRadius: 999,
                  height: 6,
                  opacity,
                  transform: [{ scale: opacity }],
                  width: 6,
                }}
              />
            ))}
          </View>
        </View>
      </View>
    </Appear>
  );
}
