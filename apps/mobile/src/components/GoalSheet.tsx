import { sx, mobileInk } from '../styles/tokens';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { MobileIcon } from './MobileIcon';
import { GlassSheet, SheetCloseButton } from './primitives/GlassSheet';
import { Gradient } from './primitives/Gradient';
import { PressableScale } from './primitives/motion';

interface GoalSheetProps {
  readonly objective: string;
  readonly canStart: boolean;
  readonly maxHeight?: number;
  readonly inputMaxHeight?: number;
  readonly onObjectiveChange: (value: string) => void;
  readonly onStart: () => void;
  readonly onClose?: () => void;
}

export function GoalSheet(props: GoalSheetProps) {
  return (
    <GlassSheet maxHeight={props.maxHeight} radius={22} style={styles.sheet}>
      <View style={sx('flex-row items-center justify-between gap-3')}>
        <View style={sx('min-w-0 flex-1 flex-row items-center gap-3')}>
          <Gradient preset="brand" radius={13} style={styles.headerIcon}>
            <MobileIcon name="goals" size={21} strokeWidth={2.3} color="#ffffff" />
          </Gradient>
          <View style={sx('min-w-0 flex-1')}>
            <Text style={sx('text-[18px] font-black', { color: mobileInk.strong, letterSpacing: -0.3 })}>Start a goal</Text>
            <Text style={sx('mt-0.5 text-[12px] font-semibold', { color: mobileInk.soft })} numberOfLines={1}>
              Run autonomously toward an objective
            </Text>
          </View>
        </View>
        {props.onClose ? <SheetCloseButton label="Close goal" onPress={props.onClose} /> : null}
      </View>
      <TextInput
        value={props.objective}
        onChangeText={props.onObjectiveChange}
        multiline
        placeholder="Describe the objective to accomplish..."
        placeholderTextColor={mobileInk.faint}
        scrollEnabled
        style={[styles.input, { maxHeight: props.inputMaxHeight }]}
      />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Start goal"
        accessibilityState={{ disabled: !props.canStart }}
        scaleTo={0.97}
        style={[styles.startButton, props.canStart ? null : { opacity: 0.5 }]}
        disabled={!props.canStart}
        onPress={props.onStart}
      >
        <Gradient preset="cta" radius={16} style={StyleSheet.absoluteFill} />
        <MobileIcon name="bolt" size={17} strokeWidth={2.4} color="#ffffff" />
        <Text style={sx('text-[15px] font-black', { color: mobileInk.onBrand })}>Start goal</Text>
      </PressableScale>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  headerIcon: {
    alignItems: 'center',
    flexShrink: 0,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  input: {
    backgroundColor: 'rgba(248,250,252,0.85)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 18,
    borderWidth: 1,
    color: mobileInk.strong,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 128,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sheet: {
    gap: 16,
    padding: 16,
  },
  startButton: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 52,
    overflow: 'hidden',
  },
});
