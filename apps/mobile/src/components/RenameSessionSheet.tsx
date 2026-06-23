import { sx } from '../styles/tokens';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { MobileIcon } from './MobileIcon';

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
  if (!props.open) return null;
  const canSubmit = props.value.trim().length > 0 && !props.saving;

  return (
    <View
      style={{
        bottom: 0,
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
        zIndex: 75,
      }}
    >
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel="Close rename session"
        style={{ backgroundColor: colors.overlay, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }}
        onPress={props.onCancel}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 96 }}
      >
        <View
          style={sx('rounded-card border border-cardBorder bg-cardBg p-4 shadow-card', {
            borderRadius: 20,
            gap: 14,
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 18 },
            shadowOpacity: 0.18,
            shadowRadius: 28,
          })}
        >
          <View style={sx('flex-row items-center justify-between gap-3')}>
            <View style={sx('min-w-0 flex-1')}>
              <Text style={sx('text-[22px] font-black text-text')}>Rename session</Text>
              <Text style={sx('mt-1 text-[12px] font-semibold text-muted')}>This updates the same session on desktop and mobile.</Text>
            </View>
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Close rename dialog"
              style={sx('h-10 w-10 items-center justify-center rounded-pill bg-appBg')}
              onPress={props.onCancel}
            >
              <MobileIcon name="x" size={19} strokeWidth={2.35} color={colors.textMuted} />
            </Pressable>
          </View>

          <TextInput
            accessibilityLabel="Session name"
            value={props.value}
            onChangeText={props.onChange}
            placeholder="Session name"
            placeholderTextColor={colors.textDim}
            autoCapitalize="sentences"
            autoCorrect
            autoFocus
            style={sx('min-h-12 rounded-block border border-cardBorder bg-appBg px-4 text-[16px] font-semibold text-text')}
            returnKeyType="done"
            onSubmitEditing={canSubmit ? props.onSubmit : undefined}
          />

          {props.error ? (
            <View style={sx('rounded-block bg-red/10 px-3 py-2')}>
              <Text style={sx('text-[12px] font-semibold text-red')}>{props.error}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Cancel rename session"
              style={sx('min-h-12 flex-1 items-center justify-center rounded-block border border-cardBorder bg-cardBg')}
              onPress={props.onCancel}
            >
              <Text style={sx('text-[14px] font-black text-muted')}>Cancel</Text>
            </Pressable>
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Save session name"
              style={sx(canSubmit ? 'bg-primary' : 'bg-cardBorder', {
                alignItems: 'center',
                borderRadius: 12,
                flex: 1,
                justifyContent: 'center',
                minHeight: 48,
              })}
              disabled={!canSubmit}
              onPress={props.onSubmit}
            >
              <Text style={sx('text-[14px] font-black text-white')}>{props.saving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
