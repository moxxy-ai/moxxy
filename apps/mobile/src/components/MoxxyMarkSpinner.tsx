import { useEffect, useRef } from 'react';
import { Animated, Easing, type ImageSourcePropType } from 'react-native';

const moxxyMark = require('../../assets/moxxy-mark.png') as ImageSourcePropType;

/**
 * The mark, turning, for loading states.
 *
 * A quarter turn is a whole loop: the mark is symmetric under 90 degrees, so
 * the animation lands back on itself and needs no easing at the seam.
 */
export function MoxxyMarkSpinner({ size = 104 }: { readonly size?: number }): JSX.Element {
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 3400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [turn]);

  return (
    <Animated.Image
      source={moxxyMark}
      resizeMode="contain"
      accessibilityLabel="Moxxy"
      style={{
        height: size,
        width: size,
        transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }],
      }}
    />
  );
}
