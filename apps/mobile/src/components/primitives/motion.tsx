import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { mobileMotion } from '../../styles/tokens';

/**
 * Tracks the OS "Reduce Motion" accessibility setting. Every animated primitive
 * here honors it: when on, entrances are instant and loops are paused, so the
 * app stays calm and vestibular-safe without losing its structure.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduced(value);
    });
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  readonly style?: StyleProp<ViewStyle>;
  /** Resting → pressed scale. Defaults to a tight, functional 0.965. */
  readonly scaleTo?: number;
  readonly children?: ReactNode;
}

/**
 * A Pressable that springs inward on touch — the single most-felt micro-
 * interaction. Functional, not decorative: it confirms the press the instant a
 * finger lands, replacing scattered `pressed ? opacity` hacks. Honors Reduce
 * Motion (no scale) and forwards every accessibility prop untouched.
 */
export function PressableScale({
  style,
  scaleTo = mobileMotion.scale.press,
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();

  const animate = (toValue: number) => {
    if (reduce || disabled) return;
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      ...mobileMotion.spring.press,
    }).start();
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event: GestureResponderEvent) => {
        animate(scaleTo);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        animate(1);
        onPressOut?.(event);
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

export interface AppearProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly from?: 'up' | 'down' | 'scale';
  readonly delay?: number;
  readonly distance?: number;
  readonly duration?: number;
}

/**
 * A one-shot entrance: fade + a short translate (or scale) with an ease-out
 * curve. Used on always-mounted chrome and overlays (not recycled list rows, to
 * keep scrolling glassy). Instant under Reduce Motion.
 */
export function Appear({
  children,
  style,
  from = 'up',
  delay = 0,
  distance = 10,
  duration = mobileMotion.duration.base,
}: AppearProps) {
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, duration, progress, reduce]);

  const transform =
    from === 'scale'
      ? [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }]
      : [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [from === 'up' ? distance : -distance, 0],
            }),
          },
        ];

  return <Animated.View style={[style, { opacity: progress, transform }]}>{children}</Animated.View>;
}

export interface PulseDotProps {
  readonly color: string;
  readonly size?: number;
  /** When true, emits a slow expanding ring — a calm "alive / connected" cue. */
  readonly pulsing?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * A status dot that can breathe. The expanding ring communicates a live state
 * (connected / working) without text or color-only signaling. Static under
 * Reduce Motion.
 */
export function PulseDot({ color, size = 9, pulsing = false, style }: PulseDotProps) {
  const reduce = useReduceMotion();
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pulsing || reduce) {
      ring.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(ring, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulsing, reduce, ring]);

  return (
    <Animated.View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {pulsing && !reduce ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size,
            backgroundColor: color,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
          }}
        />
      ) : null}
      <Animated.View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </Animated.View>
  );
}
