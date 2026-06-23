import { sx, mobileInk } from '../styles/tokens';
import { StyleSheet, Text, View } from 'react-native';
import { buildComposerAttachmentActionItems, buildQuickActionItems, type ComposerAttachmentActionItem, type QuickActionItem } from '../navigation';
import type { MobileIconName } from './MobileIcon';
import { MobileIcon } from './MobileIcon';
import { GlassSheet, SheetCloseButton } from './primitives/GlassSheet';
import { PressableScale } from './primitives/motion';

interface ComposerActionMenuProps {
  readonly open: boolean;
  readonly autoApprove: boolean;
  readonly onToggleOpen: () => void;
  readonly onGoal: () => void;
  readonly onToggleAutoApprove: () => void;
  readonly onNewSession: () => void;
  readonly onCompact: () => void;
  readonly onPickImage: () => void;
  readonly onPickFile: () => void;
  readonly onCommand: (name: string, args?: string) => void;
}

interface ComposerMenuItem {
  readonly id: string;
  readonly icon: MobileIconName;
  readonly label: string;
  readonly active?: boolean;
}

export function ComposerActionMenu(props: ComposerActionMenuProps) {
  if (!props.open) return null;

  const attachmentItems = buildComposerAttachmentActionItems();
  const items = buildQuickActionItems(props.autoApprove);
  const runAttachmentAction = (id: ComposerAttachmentActionItem['id']) => {
    if (id === 'attachImage') {
      props.onPickImage();
    } else {
      props.onPickFile();
    }
    props.onToggleOpen();
  };
  const runAction = (id: QuickActionItem['id']) => {
    if (id === 'goal') {
      props.onGoal();
      props.onToggleOpen();
      return;
    }
    if (id === 'autoApprove') {
      props.onToggleAutoApprove();
      props.onToggleOpen();
      return;
    }
    if (id === 'compact') {
      props.onCompact();
      props.onToggleOpen();
      return;
    }
    props.onNewSession();
    props.onToggleOpen();
  };

  return (
    <GlassSheet radius={20} style={styles.menu}>
      <View style={styles.header}>
        <Text style={sx('text-[11px] font-black uppercase tracking-wide', { color: mobileInk.soft })}>Actions</Text>
        <SheetCloseButton label="Close actions" onPress={props.onToggleOpen} />
      </View>
      <View style={{ gap: 4, paddingBottom: 4 }}>
        {attachmentItems.map((item) => (
          <MenuButton key={item.id} item={item} onPress={() => runAttachmentAction(item.id)} />
        ))}
      </View>
      <View>
        {items.map((item) => (
          <MenuButton key={item.id} item={item} onPress={() => runAction(item.id)} />
        ))}
      </View>
    </GlassSheet>
  );
}

function MenuButton({ item, onPress }: { readonly item: ComposerMenuItem | QuickActionItem | ComposerAttachmentActionItem; readonly onPress: () => void }) {
  return (
    <PressableScale
      accessibilityLabel={item.label}
      accessibilityRole="button"
      scaleTo={0.97}
      style={[styles.menuButton, { backgroundColor: item.active ? '#fdf2f8' : 'transparent' }]}
      onPress={onPress}
    >
      <View style={[styles.menuButtonIcon, { backgroundColor: item.active ? 'rgba(255,255,255,0.9)' : '#fdf2f8' }]}>
        <MobileIcon name={item.icon} size={15} strokeWidth={2.35} color={item.active ? '#db2777' : mobileInk.soft} />
      </View>
      <Text style={sx(`flex-1 text-[13px] font-bold ${item.active ? 'text-primaryStrong' : 'text-text'}`)}>
        {item.label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  menu: {
    bottom: 118,
    left: 16,
    padding: 8,
    position: 'absolute',
    right: 16,
    zIndex: 20,
  },
  menuButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 9,
    minHeight: 44,
    paddingHorizontal: 8,
    width: '100%',
  },
  menuButtonIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
});
