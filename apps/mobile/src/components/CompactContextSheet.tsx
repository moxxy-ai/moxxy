import { sx } from '../styles/tokens';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { BottomSheet, IconBadge } from '@/ui/kit';

interface CompactContextSheetProps {
  readonly open: boolean;
  readonly compacting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function CompactContextSheet(props: CompactContextSheetProps) {
  const { colors } = useTheme();
  return (
    <BottomSheet open={props.open} onClose={props.onCancel} title="Compact context">
      <View style={sx('px-4 pb-2', { gap: 14 })}>
        <View style={sx('flex-row items-center', { gap: 12 })}>
          <IconBadge icon="refresh" tone="brand" size={38} />
          <View style={sx('flex-1', { minWidth: 0 })}>
            <Text style={sx('text-[17px] font-black text-text')}>Compact context?</Text>
            <Text style={sx('mt-0.5 text-[13px] font-medium text-dim', { lineHeight: 18 })}>
              Older turns are summarized to free the model window; the smaller context is used on the next message.
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            accessibilityLabel="Cancel compaction"
            accessibilityRole="button"
            onPress={props.onCancel}
            style={sx('flex-1 items-center justify-center rounded-2xl border border-cardBorder', { backgroundColor: colors.surface, minHeight: 50 })}
          >
            <Text style={sx('text-[14px] font-bold text-muted')}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Confirm context compaction"
            accessibilityRole="button"
            disabled={props.compacting}
            onPress={props.onConfirm}
            style={sx('flex-1 items-center justify-center rounded-2xl', { backgroundColor: colors.primary, minHeight: 50, opacity: props.compacting ? 0.65 : 1 })}
          >
            <Text style={sx('text-[14px] font-bold text-white')}>{props.compacting ? 'Compacting…' : 'Compact now'}</Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}
