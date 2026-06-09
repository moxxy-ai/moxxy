import { Pressable, Text, View } from 'react-native';
import { MobileIcon } from './MobileIcon';

interface CompactContextSheetProps {
  readonly open: boolean;
  readonly compacting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function CompactContextSheet(props: CompactContextSheetProps) {
  if (!props.open) return null;

  return (
    <View
      className="rounded-card border border-cardBorder bg-cardBg p-4 shadow-card"
      style={{ borderColor: '#e3e5f0', borderRadius: 16, borderWidth: 1, gap: 12 }}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
        <View
          style={{
            alignItems: 'center',
            backgroundColor: '#fdf2f8',
            borderRadius: 12,
            height: 38,
            justifyContent: 'center',
            width: 38,
          }}
        >
          <MobileIcon name="actions" size={19} strokeWidth={2.45} color="#db2777" />
        </View>
        <View style={{ flex: 1 }}>
          <Text className="text-[17px] font-black text-text">Compact context?</Text>
          <Text className="mt-0.5 text-[12px] font-semibold text-muted">
            Older turns will be summarized to free the model window.
          </Text>
        </View>
      </View>

      <Text className="text-[12px] leading-5 text-muted">
        This locks the composer while Moxxy summarizes the current session. The smaller context is used on the next message.
      </Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          accessibilityLabel="Cancel compaction"
          className="flex-1 items-center justify-center rounded-block border border-cardBorder"
          style={{ minHeight: 42 }}
          onPress={props.onCancel}
        >
          <Text className="text-[13px] font-bold text-muted">Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Confirm context compaction"
          className="flex-1 items-center justify-center rounded-block bg-primary"
          disabled={props.compacting}
          style={{ minHeight: 42, opacity: props.compacting ? 0.65 : 1 }}
          onPress={props.onConfirm}
        >
          <Text className="text-[13px] font-bold text-white">
            {props.compacting ? 'Compacting...' : 'Compact now'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
