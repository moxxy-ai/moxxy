import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Image, type ImageSourcePropType, Text, View } from 'react-native';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';

const moxxyMascot = require('../../assets/moxxy-mascot-transparent.png') as ImageSourcePropType;

export function ConnectingView({ workspaceName }: { readonly workspaceName: string }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.04] });

  return (
    <View style={sx('flex-1 items-center justify-center px-6')}>
      <View style={sx('items-center justify-center', { height: 124, width: 124 })}>
        <Animated.View
          style={[
            sx('absolute rounded-full', { backgroundColor: colors.primary, height: 124, width: 124 }),
            { opacity: glowOpacity, transform: [{ scale }] },
          ]}
        />
        <View
          style={sx('items-center justify-center rounded-3xl overflow-hidden', {
            backgroundColor: colors.cardBg,
            borderColor: colors.cardBorder,
            borderWidth: 1,
            height: 86,
            width: 86,
          })}
        >
          <Image source={moxxyMascot} resizeMode="contain" accessibilityLabel="Moxxy" style={{ height: 74, width: 74 }} />
        </View>
      </View>
      <Text style={sx('mt-6 text-[20px] font-black text-text text-center')}>Connecting to your Mac…</Text>
      <Text style={sx('mt-1.5 text-[14px] font-medium text-dim text-center')} numberOfLines={1}>
        {workspaceName}
      </Text>
      <ActivityIndicator color={colors.primary} style={{ marginTop: 18 }} />
    </View>
  );
}
