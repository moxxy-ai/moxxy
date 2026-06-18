import { Pressable, Text, View } from 'react-native';
import type { ModeSelectorUiState } from '../modeSelector';
import { MobileIcon } from './MobileIcon';

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
    <View
      className="rounded-card border border-cardBorder bg-cardBg shadow-card"
      style={{
        borderColor: '#e3e5f0',
        borderRadius: 16,
        borderWidth: 1,
        gap: 10,
        padding: 12,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.12,
        shadowRadius: 24,
      }}
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-[18px] font-black text-text">Mode</Text>
          <Text className="mt-1 text-[12px] font-semibold text-muted" numberOfLines={1}>
            Active: {ui.chipLabel}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Close mode picker"
          className="h-9 w-9 items-center justify-center rounded-pill bg-appBg"
          onPress={onClose}
        >
          <MobileIcon name="x" size={18} strokeWidth={2.35} color="#64748b" />
        </Pressable>
      </View>

      <View style={{ gap: 6 }}>
        {ui.modeRows.map((mode) => (
          <Pressable
            key={mode.id}
            accessibilityRole="button"
            accessibilityState={{ selected: mode.active }}
            className={mode.active ? 'bg-primarySoft' : 'bg-appBg'}
            style={{
              alignItems: 'center',
              borderColor: mode.active ? '#f59e0b' : '#e3e5f0',
              borderRadius: 10,
              borderWidth: 1,
              flexDirection: 'row',
              gap: 8,
              minHeight: 44,
              paddingHorizontal: 10,
            }}
            onPress={() => onPickMode(mode.id)}
          >
            <Text className={`min-w-0 flex-1 text-[13px] font-bold ${mode.active ? 'text-text' : 'text-muted'}`} numberOfLines={1}>
              {mode.label}
            </Text>
            {mode.active ? <MobileIcon name="check" size={15} strokeWidth={2.4} color="#f59e0b" /> : null}
          </Pressable>
        ))}
      </View>

      {error ? (
        <View className="rounded-block bg-red/10 px-3 py-2">
          <Text className="text-[12px] font-semibold text-red">{error}</Text>
        </View>
      ) : null}
    </View>
  );
}
