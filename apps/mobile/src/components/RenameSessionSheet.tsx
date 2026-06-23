import { sx, mobileInk } from '../styles/tokens';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GlassSheet, SheetCloseButton } from './primitives/GlassSheet';
import { Gradient } from './primitives/Gradient';
import { PressableScale } from './primitives/motion';

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
    <View style={styles.overlay}>
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel="Close rename session"
        style={styles.backdrop}
        onPress={props.onCancel}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 96 }}
      >
        <GlassSheet radius={22} style={styles.card}>
          <View style={sx('flex-row items-center justify-between gap-3')}>
            <View style={sx('min-w-0 flex-1')}>
              <Text style={sx('text-[22px] font-black', { color: mobileInk.strong })}>Rename session</Text>
              <Text style={sx('mt-1 text-[12px] font-semibold', { color: mobileInk.soft })}>This updates the same session on desktop and mobile.</Text>
            </View>
            <SheetCloseButton label="Close rename dialog" onPress={props.onCancel} />
          </View>

          <TextInput
            accessibilityLabel="Session name"
            value={props.value}
            onChangeText={props.onChange}
            placeholder="Session name"
            placeholderTextColor={mobileInk.faint}
            autoCapitalize="sentences"
            autoCorrect
            autoFocus
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={canSubmit ? props.onSubmit : undefined}
          />

          {props.error ? (
            <View style={styles.errorBox}>
              <Text style={sx('text-[12px] font-semibold text-red')}>{props.error}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <PressableScale
              accessible
              accessibilityRole="button"
              accessibilityLabel="Cancel rename session"
              scaleTo={0.97}
              style={styles.cancelButton}
              onPress={props.onCancel}
            >
              <Text style={sx('text-[14px] font-black', { color: mobileInk.muted })}>Cancel</Text>
            </PressableScale>
            <PressableScale
              accessible
              accessibilityRole="button"
              accessibilityLabel="Save session name"
              accessibilityState={{ disabled: !canSubmit }}
              scaleTo={0.97}
              style={[styles.saveButton, canSubmit ? null : { opacity: 0.5 }]}
              disabled={!canSubmit}
              onPress={props.onSubmit}
            >
              <Gradient preset="cta" radius={14} style={StyleSheet.absoluteFill} />
              <Text style={sx('text-[14px] font-black', { color: mobileInk.onBrand })}>{props.saving ? 'Saving...' : 'Save'}</Text>
            </PressableScale>
          </View>
        </GlassSheet>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  cancelButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  card: {
    gap: 14,
    padding: 16,
  },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: {
    backgroundColor: 'rgba(248,250,252,0.85)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    color: mobileInk.strong,
    fontSize: 16,
    fontWeight: '600',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  overlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 75,
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    overflow: 'hidden',
  },
});
