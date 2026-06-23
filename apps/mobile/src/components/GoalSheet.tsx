import { sx } from '../styles/tokens';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { MobileIcon } from './MobileIcon';

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
  const { colors } = useTheme();
  return (
    <View style={sx('gap-4 rounded-card border border-cardBorder bg-cardBg p-4 shadow-card', { maxHeight: props.maxHeight })}>
      <View style={sx('flex-row items-center justify-between gap-3')}>
        <Text style={sx('text-[18px] font-black text-text')}>Start a goal</Text>
        {props.onClose ? (
          <Pressable accessibilityLabel="Close goal" style={sx('h-10 w-10 items-center justify-center rounded-pill')} onPress={props.onClose}>
            <MobileIcon name="x" size={19} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <TextInput
        value={props.objective}
        onChangeText={props.onObjectiveChange}
        multiline
        placeholder="Describe the objective to accomplish..."
        placeholderTextColor={colors.textDim}
        scrollEnabled
        style={sx('min-h-32 rounded-block border border-cardBorder bg-cardBg px-3 py-3 text-[14px] leading-5 text-text', {
          maxHeight: props.inputMaxHeight,
        })}
      />
      <Pressable
        style={sx(`min-h-11 items-center justify-center rounded-block ${
          props.canStart ? 'bg-primary' : 'bg-cardBorder'
        }`)}
        disabled={!props.canStart}
        onPress={props.onStart}
      >
        <Text style={sx('text-[13px] font-bold text-white')}>Start goal</Text>
      </Pressable>
    </View>
  );
}
