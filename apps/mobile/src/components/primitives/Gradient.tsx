import { useId, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
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
 * fills here — no native gradient dependency required.
 *
 * The container is measured with `onLayout` and the SVG painted at exact pixel
 * dimensions: percentage widths (`width="100%"`) resolve unreliably in
 * react-native-svg when a parent is stretched by flex *after* its first layout,
 * which left wide / dynamic elements (full-width buttons) only partially filled.
 * A solid fallback (the ramp's end colour) backs the view so there is no
 * one-frame flash before the gradient paints.
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
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const fallback = resolved.length > 0 ? resolved[resolved.length - 1].color : undefined;

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };

  return (
    <View onLayout={handleLayout} style={[{ overflow: 'hidden', borderRadius: radius, backgroundColor: fallback }, style]}>
      {size && size.width > 0 && size.height > 0 ? (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none" width={size.width} height={size.height}>
          <Defs>
            <LinearGradient id={`g${id}`} x1={dir.x1} y1={dir.y1} x2={dir.x2} y2={dir.y2}>
              {resolved.map((stop, index) => (
                <Stop key={index} offset={stop.offset} stopColor={stop.color} stopOpacity={1} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={size.width} height={size.height} fill={`url(#g${id})`} />
        </Svg>
      ) : null}
      {pointerEventsNone ? <View pointerEvents="none">{children}</View> : children}
    </View>
  );
}
