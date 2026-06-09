import { Text, View } from 'react-native';

export function ContextMeter({ usage }: { readonly usage: Record<string, unknown> | null }) {
  const prompt = typeof usage?.latestPrompt === 'number' ? usage.latestPrompt : null;
  return (
    <View className="rounded-pill bg-appBg px-3 py-1">
      <Text className="text-[11px] font-bold text-dim">
        {prompt === null ? 'Context' : `${formatShort(prompt)} ctx`}
      </Text>
    </View>
  );
}

function formatShort(value: number): string {
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}
