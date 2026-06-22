import { sx } from '../styles/tokens';
import { Text, View } from 'react-native';
import { MobileIcon } from './MobileIcon';

export function StreamingAssistant({ text }: { readonly text: string }) {
  return (
    <View style={{ alignSelf: 'stretch', flexDirection: 'row', gap: 12, maxWidth: '96%' }}>
      <View
        style={sx('bg-primarySoft', { alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', width: 34 })}
      >
        <MobileIcon name="message" size={18} strokeWidth={2.35} color="#db2777" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={sx('flex-row items-center gap-2')}>
          <Text style={sx('text-[13px] font-bold text-text')}>Assistant</Text>
          <View style={sx('h-1.5 w-1.5 rounded-pill bg-primary')} />
        </View>
        <Text style={sx('mt-1 text-[15px] leading-6 text-text')}>{text}</Text>
      </View>
    </View>
  );
}
