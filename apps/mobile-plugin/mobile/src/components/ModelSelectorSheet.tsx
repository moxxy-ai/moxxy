import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ModelSelectorUiState } from '../modelSelector';
import { MobileIcon } from './MobileIcon';

interface ModelSelectorSheetProps {
  readonly ui: ModelSelectorUiState;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSelectProvider: (provider: string) => void;
  readonly onPickModel: (provider: string, model: string | null) => void;
}

export function ModelSelectorSheet({
  ui,
  error,
  onClose,
  onSelectProvider,
  onPickModel,
}: ModelSelectorSheetProps) {
  return (
    <View
      className="rounded-card border border-cardBorder bg-cardBg shadow-card"
      style={{
        borderColor: '#e3e5f0',
        borderRadius: 16,
        borderWidth: 1,
        maxHeight: 420,
        padding: 12,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.12,
        shadowRadius: 24,
      }}
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-[18px] font-black text-text">Provider & model</Text>
          <Text className="mt-1 text-[12px] font-semibold text-muted" numberOfLines={1}>
            Active: {ui.chipLabel}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Close model picker"
          className="h-9 w-9 items-center justify-center rounded-pill bg-appBg"
          onPress={onClose}
        >
          <MobileIcon name="x" size={18} strokeWidth={2.35} color="#64748b" />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <ScrollView style={{ maxHeight: 300, width: 140 }} contentContainerStyle={{ gap: 5 }}>
          {ui.providerRows.map((provider) => (
            <Pressable
              key={provider.id}
              accessibilityRole="button"
              accessibilityState={{ selected: provider.selected }}
              className={provider.selected ? 'bg-primarySoft' : 'bg-appBg'}
              style={{
                alignItems: 'center',
                borderColor: provider.active ? '#ec4899' : '#e3e5f0',
                borderRadius: 10,
                borderWidth: 1,
                flexDirection: 'row',
                gap: 7,
                minHeight: 42,
                paddingHorizontal: 9,
              }}
              onPress={() => onSelectProvider(provider.id)}
            >
              <View
                style={{
                  backgroundColor: provider.active ? '#22c55e' : '#cbd5e1',
                  borderRadius: 999,
                  height: 7,
                  width: 7,
                }}
              />
              <Text
                className={`min-w-0 flex-1 text-[12px] font-bold ${provider.selected ? 'text-primaryStrong' : 'text-muted'}`}
                numberOfLines={1}
              >
                {provider.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView style={{ flex: 1, maxHeight: 300 }} contentContainerStyle={{ gap: 5 }}>
          {ui.modelRows.map((model) => (
            <Pressable
              key={model.id ?? 'default'}
              accessibilityRole="button"
              accessibilityState={{ selected: model.active }}
              className={model.active ? 'bg-primarySoft' : 'bg-appBg'}
              style={{
                alignItems: 'center',
                borderColor: model.active ? '#ec4899' : '#e3e5f0',
                borderRadius: 10,
                borderWidth: 1,
                flexDirection: 'row',
                gap: 8,
                minHeight: 42,
                paddingHorizontal: 10,
              }}
              onPress={() => onPickModel(ui.selectedProvider, model.id)}
            >
              <Text
                className={`min-w-0 flex-1 text-[12px] font-bold ${model.active ? 'text-primaryStrong' : 'text-text'}`}
                numberOfLines={1}
              >
                {model.label}
              </Text>
              {model.active ? <MobileIcon name="check" size={15} strokeWidth={2.4} color="#db2777" /> : null}
            </Pressable>
          ))}
          {ui.modelRows.length === 0 ? (
            <View className="rounded-block border border-cardBorder bg-appBg px-3 py-3">
              <Text className="text-[12px] font-bold text-muted">No models advertised by this provider.</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>

      {error ? (
        <View className="mt-3 rounded-block bg-red/10 px-3 py-2">
          <Text className="text-[12px] font-semibold text-red">{error}</Text>
        </View>
      ) : null}
    </View>
  );
}
