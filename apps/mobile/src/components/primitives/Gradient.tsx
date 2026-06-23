import { useId, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { mobileGradients, type GradientStop } from '../../styles/tokens';

type Direction = 'diagonal' | 'vertical' | 'horizontal' | 'diagonalUp';

const DIRECTIONS: Record<Direction, { x1: string; y1: string; x2: string; y2: string }> = {
  // 135° — matches the desktop `linear-gradient(135deg, …)` ramps.
  diagonal: { x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
  diagonalUp: { x1: '0%', y1: '100%', x2: '100%', y2: '0%' },
  vertical: { x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
  horizontal: { x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
};

export interface GradientProps {
  /** A named brand ramp, or an explicit list of stops. */
  readonly preset?: keyof typeof mobileGradients;
  readonly stops?: ReadonlyArray<GradientStop>;
  readonly direction?: Direction;
  readonly radius?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly children?: ReactNode;
  readonly pointerEventsNone?: boolean;
}

/**
 * A pure `react-native-svg` linear-gradient fill that sits behind its children.
 * The brand's gradients (defined once in `mobileGradients`) become real, painted
 * fills here — no native gradient dependency required. Apply `radius` (or a
 * `borderRadius` on `style`) and the gradient is clipped to match.
 */
export function Gradient({
  preset = 'cta',
  stops,
  direction = 'diagonal',
  radius = 0,
  style,
  children,
  pointerEventsNone,
}: GradientProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const resolved = stops ?? mobileGradients[preset];
  const dir = DIRECTIONS[direction];

  return (
    <View style={[{ overflow: 'hidden', borderRadius: radius }, style]}>
      <Svg
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        width="100%"
        height="100%"
        preserveAspectRatio="none"
      >
        <Defs>
          <LinearGradient id={`g${id}`} x1={dir.x1} y1={dir.y1} x2={dir.x2} y2={dir.y2}>
            {resolved.map((stop, index) => (
              <Stop key={index} offset={stop.offset} stopColor={stop.color} stopOpacity={1} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" rx={radius} ry={radius} fill={`url(#g${id})`} />
      </Svg>
      {pointerEventsNone ? <View pointerEvents="none">{children}</View> : children}
    </View>
  );
}
