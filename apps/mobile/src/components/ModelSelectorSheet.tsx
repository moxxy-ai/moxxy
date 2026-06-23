import { sx, mobileInk, mobileSurface } from '../styles/tokens';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ModelSelectorUiState } from '../modelSelector';
import { MobileIcon } from './MobileIcon';
import { GlassSheet, SheetCloseButton } from './primitives/GlassSheet';
import { PressableScale } from './primitives/motion';

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
    <GlassSheet maxHeight={420} radius={22} style={styles.sheet}>
      <View style={sx('flex-row items-center justify-between gap-3')}>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[18px] font-black', { color: mobileInk.strong })}>Provider & model</Text>
          <Text style={sx('mt-1 text-[12px] font-semibold', { color: mobileInk.soft })} numberOfLines={1}>
            Active: {ui.chipLabel}
          </Text>
        </View>
        <SheetCloseButton label="Close model picker" onPress={onClose} />
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <ScrollView style={{ maxHeight: 300, width: 140 }} contentContainerStyle={{ gap: 5 }}>
          {ui.providerRows.map((provider) => (
            <PressableScale
              key={provider.id}
              accessibilityRole="button"
              accessibilityState={{ selected: provider.selected }}
              scaleTo={0.97}
              style={[
                styles.row,
                {
                  backgroundColor: provider.selected ? mobileSurface.accentSoft : mobileSurface.card,
                  borderColor: provider.active ? mobileSurface.accentBorder : mobileSurface.border,
                  borderWidth: provider.active ? 1.5 : 1,
                  gap: 7,
                  paddingHorizontal: 9,
                },
              ]}
              onPress={() => onSelectProvider(provider.id)}
            >
              <View
                style={{
                  backgroundColor: provider.active ? '#22c55e' : mobileInk.faint,
                  borderRadius: 999,
                  height: 7,
                  width: 7,
                }}
              />
              <Text
                style={sx('min-w-0 flex-1 text-[12px] font-bold', { color: provider.selected ? mobileSurface.accentStrong : mobileInk.muted })}
                numberOfLines={1}
              >
                {provider.label}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>

        <ScrollView style={{ flex: 1, maxHeight: 300 }} contentContainerStyle={{ gap: 5 }}>
          {ui.modelRows.map((model) => (
            <PressableScale
              key={model.id ?? 'default'}
              accessibilityRole="button"
              accessibilityState={{ selected: model.active }}
              scaleTo={0.97}
              style={[
                styles.row,
                {
                  backgroundColor: model.active ? mobileSurface.accentSoft : mobileSurface.card,
                  borderColor: model.active ? mobileSurface.accentBorder : mobileSurface.border,
                  borderWidth: model.active ? 1.5 : 1,
                  gap: 8,
                  paddingHorizontal: 10,
                },
              ]}
              onPress={() => onPickModel(ui.selectedProvider, model.id)}
            >
              <Text
                style={sx('min-w-0 flex-1 text-[12px] font-bold', { color: model.active ? mobileSurface.accentStrong : mobileInk.strong })}
                numberOfLines={1}
              >
                {model.label}
              </Text>
              {model.active ? <MobileIcon name="check" size={15} strokeWidth={2.4} color={mobileSurface.accentStrong} /> : null}
            </PressableScale>
          ))}
          {ui.modelRows.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={sx('text-[12px] font-bold', { color: mobileInk.soft })}>No models advertised by this provider.</Text>
            </View>
          ) : null}
        </ScrollView>
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
  emptyBox: {
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 14,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    minHeight: 44,
  },
  sheet: {
    padding: 12,
  },
});
