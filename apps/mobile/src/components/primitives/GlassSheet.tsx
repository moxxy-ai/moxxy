import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { mobileFlat, mobileInk, mobileSurface } from '../../styles/tokens';
import { MobileIcon } from '../MobileIcon';
import { PressableScale } from './motion';

export interface GlassSheetProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly maxHeight?: number;
  readonly radius?: number;
  readonly testID?: string;
}

/**
 * The shared floating-sheet shell (V2, refined-minimal): a clean white card with
 * a hairline border and a whisper of floating shadow. Every chat overlay drops
 * its content in here so they all read as one quiet material.
 */
export function GlassSheet({ children, style, maxHeight, radius = 20, testID }: GlassSheetProps) {
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        { borderRadius: radius },
        maxHeight != null ? { maxHeight } : null,
        mobileFlat.floating,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A consistent round close (✕) button for sheet headers. */
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
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderWidth: 1,
  },
  close: {
    alignItems: 'center',
    backgroundColor: mobileSurface.field,
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  eyebrow: {
    color: mobileInk.soft,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
