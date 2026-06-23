import { sx } from '../styles/tokens';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { BottomSheet } from '@/ui/kit';

interface RenameSessionSheetProps {
  readonly open: boolean;
  readonly value: string;
  readonly error: string | null;
  readonly saving: boolean;
  readonly onChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
}

export function RenameSessionSheet(props: RenameSessionSheetProps) {
  const { colors } = useTheme();
  const canSubmit = props.value.trim().length > 0 && !props.saving;

  return (
    <BottomSheet open={props.open} onClose={props.onCancel} title="Rename chat" avoidKeyboard>
      <View style={sx('px-4 pb-2', { gap: 14 })}>
        <TextInput
          accessibilityLabel="Chat name"
          value={props.value}
          onChangeText={props.onChange}
          placeholder="Chat name"
          placeholderTextColor={colors.textDim}
          autoCapitalize="sentences"
          autoCorrect
          autoFocus
          returnKeyType="done"
          onSubmitEditing={canSubmit ? props.onSubmit : undefined}
          style={sx('rounded-2xl px-4 text-[16px] font-semibold text-text', {
            backgroundColor: colors.inputSoft,
            borderColor: colors.cardBorder,
            borderWidth: 1,
            minHeight: 50,
          })}
        />

        {props.error ? (
          <View style={sx('rounded-2xl px-3 py-2', { backgroundColor: colors.redSoft, borderColor: colors.redBorder, borderWidth: 1 })}>
            <Text style={sx('text-[13px] font-semibold', { color: colors.redText })}>{props.error}</Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            accessibilityLabel="Cancel rename"
            accessibilityRole="button"
            onPress={props.onCancel}
            style={sx('flex-1 items-center justify-center rounded-2xl border border-cardBorder', { backgroundColor: colors.surface, minHeight: 50 })}
          >
            <Text style={sx('text-[14px] font-bold text-muted')}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Save chat name"
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={props.onSubmit}
            style={sx('flex-1 items-center justify-center rounded-2xl', { backgroundColor: canSubmit ? colors.primary : colors.cardBorderStrong, minHeight: 50 })}
          >
            <Text style={sx('text-[14px] font-bold text-white')}>{props.saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}
