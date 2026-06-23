import { StyleSheet, Text, View } from 'react-native';
import { mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import { buildComposerAttachmentActionItems, buildQuickActionItems, type ComposerAttachmentActionItem, type QuickActionItem } from '../navigation';
import type { MobileIconName } from './MobileIcon';
import { MobileIcon } from './MobileIcon';
import { PressableScale } from './primitives/motion';

interface ComposerActionMenuProps {
  readonly open: boolean;
  readonly autoApprove: boolean;
  readonly modelLabel: string;
  readonly modeLabel: string;
  readonly modeAttention: boolean;
  readonly onToggleOpen: () => void;
  readonly onOpenModelSelector: () => void;
  readonly onOpenModeSelector: () => void;
  readonly onGoal: () => void;
  readonly onToggleAutoApprove: () => void;
  readonly onNewSession: () => void;
  readonly onCompact: () => void;
  readonly onPickImage: () => void;
  readonly onPickFile: () => void;
  readonly onCommand: (name: string, args?: string) => void;
}

export function ComposerActionMenu(props: ComposerActionMenuProps) {
  if (!props.open) return null;

  const attachmentItems = buildComposerAttachmentActionItems();
  const items = buildQuickActionItems(props.autoApprove);
  const runAttachmentAction = (id: ComposerAttachmentActionItem['id']) => {
    if (id === 'attachImage') props.onPickImage();
    else props.onPickFile();
    props.onToggleOpen();
  };
  const runAction = (id: QuickActionItem['id']) => {
    if (id === 'goal') props.onGoal();
    else if (id === 'autoApprove') props.onToggleAutoApprove();
    else if (id === 'compact') props.onCompact();
    else props.onNewSession();
    props.onToggleOpen();
  };

  return (
    <View style={styles.menu}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Settings</Text>
        <PressableScale accessibilityRole="button" accessibilityLabel="Close menu" hitSlop={8} scaleTo={0.88} style={styles.close} onPress={props.onToggleOpen}>
          <MobileIcon name="x" size={16} strokeWidth={2.5} color={mobileInk.soft} />
        </PressableScale>
      </View>

      <PickerRow label="Model" value={props.modelLabel} onPress={() => { props.onOpenModelSelector(); props.onToggleOpen(); }} />
      <PickerRow label="Mode" value={props.modeLabel} attention={props.modeAttention} onPress={() => { props.onOpenModeSelector(); props.onToggleOpen(); }} />

      <View style={styles.divider} />

      {attachmentItems.map((item) => (
        <MenuButton key={item.id} icon={item.icon} label={item.label} onPress={() => runAttachmentAction(item.id)} />
      ))}
      {items.map((item) => (
        <MenuButton key={item.id} icon={item.icon} label={item.label} active={item.active} onPress={() => runAction(item.id)} />
      ))}
    </View>
  );
}

function PickerRow({
  label,
  value,
  attention,
  onPress,
}: {
  readonly label: string;
  readonly value: string;
  readonly attention?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} scaleTo={0.98} style={styles.pickerRow} onPress={onPress}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <Text style={[styles.pickerValue, attention ? styles.pickerValueAttention : null]} numberOfLines={1}>
        {value}
      </Text>
      <MobileIcon name="chevronRight" size={15} strokeWidth={2.4} color={mobileInk.faint} />
    </PressableScale>
  );
}

function MenuButton({
  icon,
  label,
  active,
  onPress,
}: {
  readonly icon: MobileIconName;
  readonly label: string;
  readonly active?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <PressableScale accessibilityLabel={label} accessibilityRole="button" scaleTo={0.98} style={styles.menuButton} onPress={onPress}>
      <MobileIcon name={icon} size={18} strokeWidth={2.3} color={active ? mobileSurface.accentStrong : mobileInk.muted} />
      <Text style={[styles.menuButtonLabel, active ? styles.menuButtonLabelActive : null]}>{label}</Text>
      {active ? <View style={styles.activeDot} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  activeDot: {
    backgroundColor: mobileSurface.accent,
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  close: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  divider: {
    backgroundColor: mobileSurface.divider,
    height: 1,
    marginVertical: 6,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 2,
    paddingLeft: 8,
  },
  headerLabel: {
    color: mobileInk.soft,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  menu: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 18,
    borderWidth: 1,
    bottom: 96,
    left: 12,
    padding: 6,
    position: 'absolute',
    right: 12,
    zIndex: 20,
    ...mobileFlat.floating,
  },
  menuButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  menuButtonLabel: {
    color: mobileInk.strong,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  menuButtonLabelActive: {
    color: mobileSurface.accentStrong,
    fontWeight: '800',
  },
  pickerLabel: {
    color: mobileInk.soft,
    fontSize: 14,
    fontWeight: '700',
    width: 56,
  },
  pickerRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  pickerValue: {
    color: mobileInk.strong,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  pickerValueAttention: {
    color: '#b45309',
  },
});
