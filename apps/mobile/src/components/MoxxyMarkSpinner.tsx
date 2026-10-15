import type { ReactElement } from 'react';
import { Animated, type ImageSourcePropType } from 'react-native';
import { useMarkBreathing } from '../hooks/useMarkBreathing';

const moxxyMark = require('../../assets/moxxy-mark.png') as ImageSourcePropType;

/**
 * The mark, breathing, for loading states: it eases in and dims, then back.
 * The mark is a lit face, not a symmetric figure, so it does not turn.
 */
export function MoxxyMarkSpinner({ size = 104 }: { readonly size?: number }): ReactElement {
  const breath = useMarkBreathing();

  return (
    <Animated.Image
      source={moxxyMark}
      resizeMode="contain"
      accessibilityLabel="Moxxy"
      style={{
        height: size,
        width: size,
        opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }),
        transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }) }],
      }}
    />
  );
}
