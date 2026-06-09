import { Text, View } from 'react-native';
import { MobileIcon } from './MobileIcon';

export function ThinkingIndicator() {
  return (
    <View style={{ alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 10 }}>
      <View
        className="bg-primarySoft"
        style={{ alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', width: 34 }}
      >
        <MobileIcon name="message" size={18} strokeWidth={2.35} color="#db2777" />
      </View>
      <View
        className="rounded-block border border-cardBorder bg-cardBg"
        style={{ borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 }}
      >
        <Text className="text-[13px] font-bold text-muted">Thinking</Text>
      </View>
    </View>
  );
}
