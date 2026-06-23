import { sx, mobileInk } from '../styles/tokens';
import { StyleSheet, Text, View } from 'react-native';
import type { ModeSelectorUiState } from '../modeSelector';
import { MobileIcon } from './MobileIcon';
import { GlassSheet, SheetCloseButton } from './primitives/GlassSheet';
import { PressableScale } from './primitives/motion';

interface ModeSelectorSheetProps {
  readonly ui: ModeSelectorUiState;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onPickMode: (mode: string) => void;
}

export function ModeSelectorSheet({
  ui,
  error,
  onClose,
  onPickMode,
}: ModeSelectorSheetProps) {
  return (
    <GlassSheet radius={22} style={styles.sheet}>
      <View style={sx('flex-row items-center justify-between gap-3')}>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[18px] font-black', { color: mobileInk.strong })}>Mode</Text>
          <Text style={sx('mt-1 text-[12px] font-semibold', { color: mobileInk.soft })} numberOfLines={1}>
            Active: {ui.chipLabel}
          </Text>
        </View>
        <SheetCloseButton label="Close mode picker" onPress={onClose} />
      </View>

      <View style={{ gap: 6 }}>
        {ui.modeRows.map((mode) => (
          <PressableScale
            key={mode.id}
            accessibilityRole="button"
            accessibilityState={{ selected: mode.active }}
            scaleTo={0.97}
            style={[
              styles.row,
              {
                backgroundColor: mode.active ? '#fffbeb' : 'rgba(255,255,255,0.7)',
                borderColor: mode.active ? '#f59e0b' : 'rgba(226,228,240,0.9)',
                borderWidth: mode.active ? 1.5 : 1,
              },
            ]}
            onPress={() => onPickMode(mode.id)}
          >
            <Text
              style={sx('min-w-0 flex-1 text-[13px] font-bold', { color: mode.active ? mobileInk.strong : mobileInk.muted })}
              numberOfLines={1}
            >
              {mode.label}
            </Text>
            {mode.active ? <MobileIcon name="check" size={15} strokeWidth={2.4} color="#f59e0b" /> : null}
          </PressableScale>
        ))}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={sx('text-[12px] font-semibold text-red')}>{error}</Text>
        </View>
      ) : null}
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  sheet: {
    gap: 10,
    padding: 12,
  },
});
