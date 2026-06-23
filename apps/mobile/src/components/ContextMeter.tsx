import { sx, mobileInk, mobileSurface } from '../styles/tokens';
import { StyleSheet, Text, View } from 'react-native';
import { buildContextMeterUiState } from '../contextMeterUi';

export function ContextMeter({ usage }: { readonly usage: Record<string, unknown> | null }) {
  const prompt = typeof usage?.latestPrompt === 'number' ? usage.latestPrompt : null;
  const contextWindow = typeof usage?.contextWindow === 'number' ? usage.contextWindow : null;
  const ui = buildContextMeterUiState({ latestPrompt: prompt, contextWindow });
  const fillColor = ui.tone === 'red' ? '#ef4444' : ui.tone === 'amber' ? '#f59e0b' : mobileSurface.accent;

  if (!ui.visible) {
    return (
      <View style={styles.pill}>
        <Text style={[sx('text-[11px] font-bold'), { color: mobileInk.soft }]}>Context</Text>
      </View>
    );
  }

  return (
    <View style={[styles.pill, sx('flex-row items-center gap-2')]}>
      <View style={styles.track}>
        <View
          style={{
            backgroundColor: fillColor,
            borderRadius: 999,
            height: '100%',
            width: `${ui.fillPercent}%`,
          }}
        />
      </View>
      <Text style={[sx('text-[11px] font-bold tabular-nums'), { color: mobileInk.soft }]}>{ui.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  track: {
    backgroundColor: mobileSurface.borderStrong,
    borderRadius: 999,
    height: 5,
    overflow: 'hidden',
    width: 30,
  },
});
