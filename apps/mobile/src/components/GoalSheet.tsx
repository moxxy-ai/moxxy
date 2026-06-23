import { sx, mobileInk } from '../styles/tokens';
import { StyleSheet, Text, TextInput, View } from 'react-native';
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
        <Text style={sx('text-[18px] font-black', { color: mobileInk.strong })}>Start a goal</Text>
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
        <Gradient preset="cta" radius={14} style={StyleSheet.absoluteFill} />
        <Text style={sx('text-[14px] font-black', { color: mobileInk.onBrand })}>Start goal</Text>
      </PressableScale>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
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
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 48,
    overflow: 'hidden',
  },
});
