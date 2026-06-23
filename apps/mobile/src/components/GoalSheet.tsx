import { sx } from '../styles/tokens';
import { Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { BottomSheet, Button } from '@/ui/kit';

interface GoalSheetProps {
  readonly open: boolean;
  readonly objective: string;
  readonly canStart: boolean;
  readonly onObjectiveChange: (value: string) => void;
  readonly onStart: () => void;
  readonly onClose: () => void;
}

export function GoalSheet(props: GoalSheetProps) {
  const { colors } = useTheme();
  return (
    <BottomSheet open={props.open} onClose={props.onClose} title="Start a goal" avoidKeyboard>
      <View style={{ gap: 14, paddingBottom: 8, paddingHorizontal: 16 }}>
        <Text style={sx('text-[13px] font-medium text-dim', { lineHeight: 18 })}>
          Describe an objective and moxxy will work toward it autonomously.
        </Text>
        <TextInput
          accessibilityLabel="Goal objective"
          value={props.objective}
          onChangeText={props.onObjectiveChange}
          multiline
          autoFocus
          placeholder="Describe the objective to accomplish…"
          placeholderTextColor={colors.textDim}
          style={sx('rounded-2xl px-4 py-3 text-[15px] leading-6 text-text', {
            backgroundColor: colors.inputSoft,
            borderColor: colors.cardBorder,
            borderWidth: 1,
            maxHeight: 220,
            minHeight: 120,
          })}
        />
        <Button label="Start goal" icon="goals" disabled={!props.canStart} onPress={props.onStart} />
      </View>
    </BottomSheet>
  );
}
