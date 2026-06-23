import { sx, mobileInk } from '../styles/tokens';
import { StyleSheet, Text, View } from 'react-native';
import { MobileIcon } from './MobileIcon';
import { GlassSheet } from './primitives/GlassSheet';
import { Gradient } from './primitives/Gradient';
import { PressableScale } from './primitives/motion';

interface CompactContextSheetProps {
  readonly open: boolean;
  readonly compacting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function CompactContextSheet(props: CompactContextSheetProps) {
  if (!props.open) return null;

  return (
    <GlassSheet radius={22} style={styles.sheet}>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 12 }}>
        <Gradient preset="brand" radius={12} style={styles.iconBadge}>
          <MobileIcon name="actions" size={19} strokeWidth={2.45} color="#ffffff" />
        </Gradient>
        <View style={{ flex: 1 }}>
          <Text style={sx('text-[17px] font-black', { color: mobileInk.strong })}>Compact context?</Text>
          <Text style={sx('mt-0.5 text-[12px] font-semibold', { color: mobileInk.soft })}>
            Older turns will be summarized to free the model window.
          </Text>
        </View>
      </View>

      <Text style={sx('text-[12px] leading-5', { color: mobileInk.soft })}>
        This locks the composer while Moxxy summarizes the current session. The smaller context is used on the next message.
      </Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <PressableScale
          accessibilityLabel="Cancel compaction"
          accessibilityRole="button"
          scaleTo={0.96}
          style={styles.cancelButton}
          onPress={props.onCancel}
        >
          <Text style={sx('text-[13px] font-bold', { color: mobileInk.muted })}>Cancel</Text>
        </PressableScale>
        <PressableScale
          accessibilityLabel="Confirm context compaction"
          accessibilityRole="button"
          accessibilityState={{ disabled: props.compacting }}
          scaleTo={0.96}
          style={[styles.confirmButton, props.compacting ? { opacity: 0.65 } : null]}
          disabled={props.compacting}
          onPress={props.onConfirm}
        >
          <Gradient preset="cta" radius={14} style={StyleSheet.absoluteFill} />
          <Text style={sx('text-[13px] font-bold', { color: mobileInk.onBrand })}>
            {props.compacting ? 'Compacting...' : 'Compact now'}
          </Text>
        </PressableScale>
      </View>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  cancelButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  confirmButton: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    overflow: 'hidden',
  },
  iconBadge: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sheet: {
    gap: 12,
    padding: 16,
  },
});
