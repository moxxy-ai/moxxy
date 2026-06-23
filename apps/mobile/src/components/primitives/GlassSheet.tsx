import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { mobileElevation, mobileGlass, mobileInk } from '../../styles/tokens';
import { MobileIcon } from '../MobileIcon';
import { Gradient } from './Gradient';
import { PressableScale } from './motion';

export interface GlassSheetProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly maxHeight?: number;
  readonly radius?: number;
  readonly testID?: string;
}

/**
 * The shared floating-sheet shell: a frosted glass card with a hairline,
 * top sheen and a deep, soft shadow. Every chat overlay (asks, goal, pickers,
 * compact, session actions, rename…) drops its content in here so they all read
 * as the same material instead of each re-inventing a white card + shadow.
 */
export function GlassSheet({ children, style, maxHeight, radius = 22, testID }: GlassSheetProps) {
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        { borderRadius: radius, borderTopColor: mobileGlass.sheet.hairline },
        maxHeight != null ? { maxHeight } : null,
        mobileElevation.lg,
        style,
      ]}
    >
      <Gradient
        pointerEventsNone
        direction="vertical"
        stops={[
          { offset: 0, color: mobileGlass.sheet.sheen },
          { offset: 1, color: 'rgba(255,255,255,0)' },
        ]}
        style={[styles.sheen, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]}
      />
      {children}
    </View>
  );
}

/** A consistent round glass close (✕) button for sheet headers. */
export function SheetCloseButton({ onPress, label = 'Close' }: { readonly onPress: () => void; readonly label?: string }) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} scaleTo={0.88} style={styles.close}>
      <MobileIcon name="x" size={18} strokeWidth={2.5} color={mobileInk.soft} />
    </PressableScale>
  );
}

/** A small uppercase section/eyebrow label in the muted-but-readable ink. */
export function SheetEyebrow({ children }: { readonly children: ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileGlass.sheet.fill,
    borderColor: mobileGlass.sheet.border,
    borderWidth: 1,
  },
  close: {
    alignItems: 'center',
    backgroundColor: 'rgba(248,250,252,0.9)',
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  eyebrow: {
    color: mobileInk.soft,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sheen: {
    height: 48,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
