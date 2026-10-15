import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform } from 'react-native';

const HALF_BREATH_MS = 1200;

/**
 * The mark's loading breath as a looping 0 → 1 → 0 value, the same 2.4s
 * ease-in-out the desktop's `.moxxy-avatar-loader` runs. Stops on unmount.
 */
export function useMarkBreathing(): Animated.Value {
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const half = (toValue: number) =>
      Animated.timing(breath, {
        toValue,
        duration: HALF_BREATH_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      });
    const loop = Animated.loop(Animated.sequence([half(1), half(0)]));
    loop.start();
    return () => loop.stop();
  }, [breath]);

  return breath;
}
