import { sx } from '../styles/tokens';
import { Text, View } from 'react-native';
import { buildContextMeterUiState } from '../contextMeterUi';

export function ContextMeter({ usage }: { readonly usage: Record<string, unknown> | null }) {
  const prompt = typeof usage?.latestPrompt === 'number' ? usage.latestPrompt : null;
  const contextWindow = typeof usage?.contextWindow === 'number' ? usage.contextWindow : null;
  const ui = buildContextMeterUiState({ latestPrompt: prompt, contextWindow });
  const fillColor = ui.tone === 'red' ? '#ef4444' : ui.tone === 'amber' ? '#f59e0b' : '#ec4899';

  if (!ui.visible) {
    return (
      <View style={sx('rounded-pill bg-appBg px-3 py-1')}>
        <Text style={sx('text-[11px] font-bold text-dim')}>Context</Text>
      </View>
    );
  }

  return (
    <View style={sx('flex-row items-center gap-2 rounded-pill bg-appBg px-3 py-1')}>
      <View
        style={{
          backgroundColor: 'rgba(148, 163, 184, 0.22)',
          borderRadius: 999,
          height: 5,
          overflow: 'hidden',
          width: 30,
        }}
      >
        <View
          style={{
            backgroundColor: fillColor,
            borderRadius: 999,
            height: '100%',
            width: `${ui.fillPercent}%`,
          }}
        />
      </View>
      <Text style={sx('text-[11px] font-bold tabular-nums text-dim')}>{ui.label}</Text>
    </View>
  );
}
