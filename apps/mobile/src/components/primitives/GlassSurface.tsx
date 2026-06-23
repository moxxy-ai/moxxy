import { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { mobileElevation, mobileGlass } from '../../styles/tokens';
import { Gradient } from './Gradient';

type GlassVariant = keyof typeof mobileGlass;
type ElevationKey = keyof typeof mobileElevation;

export interface GlassSurfaceProps {
  readonly variant?: GlassVariant;
  readonly elevation?: ElevationKey | 'none';
  readonly radius?: number;
  /** Top specular sheen overlay — the liquid-glass "lensing" cue. */
  readonly sheen?: boolean;
  readonly borderless?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly children?: ReactNode;
  readonly testID?: string;
}

/**
 * A frosted, layered surface in the iOS-26 "liquid glass" spirit: a translucent
 * tinted fill, a hairline border whose top edge brightens into a specular line,
 * a soft top sheen, and a tuned depth shadow. Pure React Native — the frosting
 * is achieved with layered translucency rather than a backdrop blur, so it adds
 * no native dependency. (Swap the fill for an `expo-blur` `BlurView` here and
 * every caller upgrades for free.)
 *
 * The shadow lives on this same view with NO `overflow: hidden`, so it renders
 * correctly; the sheen clips itself to the top corners via its own rounding.
 */
export function GlassSurface({
  variant = 'card',
  elevation = 'md',
  radius = 20,
  sheen = true,
  borderless = false,
  style,
  children,
  testID,
}: GlassSurfaceProps) {
  const spec = mobileGlass[variant];
  const shadow = elevation === 'none' ? null : mobileElevation[elevation];

  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: spec.fill,
          borderRadius: radius,
          borderColor: spec.border,
          borderTopColor: spec.hairline,
          borderWidth: borderless ? 0 : 1,
        },
        shadow,
        style,
      ]}
    >
      {sheen ? (
        <Gradient
          pointerEventsNone
          direction="vertical"
          stops={[
            { offset: 0, color: spec.sheen },
            { offset: 1, color: 'rgba(255,255,255,0)' },
          ]}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '60%',
            borderTopLeftRadius: radius,
            borderTopRightRadius: radius,
          }}
        />
      ) : null}
      {children}
    </View>
  );
}
