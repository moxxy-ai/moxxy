import { mobileInk, mobileSurface } from '../styles/tokens';
import { Animated, Text, View } from 'react-native';
import { useThinkingDots } from '@/hooks/useThinkingDots';
import { MobileIcon } from './MobileIcon';
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
        <View
          style={{
            alignItems: 'center',
            backgroundColor: mobileSurface.accentSoft,
            borderRadius: 999,
            height: 34,
            justifyContent: 'center',
            width: 34,
          }}
        >
          <MobileIcon name="message" size={18} strokeWidth={2.4} color={mobileSurface.accent} />
        </View>
        <View
          style={{
            alignItems: 'center',
            backgroundColor: mobileSurface.card,
            borderColor: mobileSurface.border,
            borderRadius: 14,
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
                  backgroundColor: mobileSurface.accent,
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
