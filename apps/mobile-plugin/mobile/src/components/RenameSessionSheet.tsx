import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
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
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.3)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }}
        onPress={props.onCancel}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 96 }}
      >
        <View
          className="rounded-card border border-cardBorder bg-cardBg p-4 shadow-card"
          style={{
            borderColor: '#e3e5f0',
            borderRadius: 20,
            borderWidth: 1,
            gap: 14,
            shadowColor: '#0f172a',
            shadowOffset: { width: 0, height: 18 },
            shadowOpacity: 0.18,
            shadowRadius: 28,
          }}
        >
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-[22px] font-black text-text">Rename session</Text>
              <Text className="mt-1 text-[12px] font-semibold text-muted">This updates the same session on desktop and mobile.</Text>
            </View>
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Close rename dialog"
              className="h-10 w-10 items-center justify-center rounded-pill bg-appBg"
              onPress={props.onCancel}
            >
              <MobileIcon name="x" size={19} strokeWidth={2.35} color="#64748b" />
            </Pressable>
          </View>

          <TextInput
            accessibilityLabel="Session name"
            value={props.value}
            onChangeText={props.onChange}
            placeholder="Session name"
            placeholderTextColor="#94a3b8"
            autoCapitalize="sentences"
            autoCorrect
            autoFocus
            className="min-h-12 rounded-block border border-cardBorder bg-appBg px-4 text-[16px] font-semibold text-text"
            returnKeyType="done"
            onSubmitEditing={canSubmit ? props.onSubmit : undefined}
          />

          {props.error ? (
            <View className="rounded-block bg-red/10 px-3 py-2">
              <Text className="text-[12px] font-semibold text-red">{props.error}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Cancel rename session"
              className="min-h-12 flex-1 items-center justify-center rounded-block border border-cardBorder bg-cardBg"
              onPress={props.onCancel}
            >
              <Text className="text-[14px] font-black text-muted">Cancel</Text>
            </Pressable>
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Save session name"
              className={canSubmit ? 'bg-primary' : 'bg-cardBorder'}
              disabled={!canSubmit}
              style={{ alignItems: 'center', borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 48 }}
              onPress={props.onSubmit}
            >
              <Text className="text-[14px] font-black text-white">{props.saving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
