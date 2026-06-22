import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';

export function useThinkingDots() {
  const valuesRef = useRef([
    new Animated.Value(0.35),
    new Animated.Value(0.35),
    new Animated.Value(0.35),
  ]);

  useEffect(() => {
    const animations = valuesRef.current.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 140),
          Animated.timing(value, {
            duration: 320,
            toValue: 1,
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.timing(value, {
            duration: 320,
            toValue: 0.35,
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.delay((valuesRef.current.length - index - 1) * 140),
        ]),
      ),
    );
    animations.forEach((animation) => animation.start());
    return () => {
      animations.forEach((animation) => animation.stop());
    };
  }, []);

  return valuesRef.current;
}
