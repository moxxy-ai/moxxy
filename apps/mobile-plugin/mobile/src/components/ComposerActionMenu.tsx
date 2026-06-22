import { sx } from '../styles/tokens';
import { Pressable, Text, View } from 'react-native';
import { buildComposerAttachmentActionItems, buildQuickActionItems, type ComposerAttachmentActionItem, type QuickActionItem } from '../navigation';
import type { MobileIconName } from './MobileIcon';
import { MobileIcon } from './MobileIcon';

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
    <View
      style={sx('absolute z-20 rounded-card border border-cardBorder bg-cardBg shadow-card', {
        bottom: 118,
        left: 16,
        padding: 4,
        right: 16,
      })}
    >
      <View
        style={sx('flex-row items-center justify-between', {
          alignItems: 'center',
          flexDirection: 'row',
          paddingHorizontal: 6,
          paddingVertical: 4,
        })}
      >
        <Text style={sx('text-[11px] font-black uppercase text-dim')}>Actions</Text>
        <Pressable accessibilityLabel="Close actions" accessibilityRole="button" style={sx('h-9 w-9 items-center justify-center rounded-pill')} onPress={props.onToggleOpen}>
          <MobileIcon name="x" size={18} color="#64748b" />
        </Pressable>
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
    </View>
  );
}

function MenuButton({ item, onPress }: { readonly item: ComposerMenuItem | QuickActionItem | ComposerAttachmentActionItem; readonly onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="button"
      style={sx(item.active ? 'bg-primarySoft' : 'bg-transparent', {
        alignItems: 'center',
        borderRadius: 8,
        flexDirection: 'row',
        gap: 9,
        minHeight: 40,
        paddingHorizontal: 10,
        width: '100%',
      })}
      onPress={onPress}
    >
      <View
        style={sx(item.active ? 'bg-cardBg' : 'bg-primarySoft', { alignItems: 'center', borderRadius: 8, height: 28, justifyContent: 'center', width: 28 })}
      >
        <MobileIcon name={item.icon} size={15} strokeWidth={2.35} color={item.active ? '#db2777' : '#64748b'} />
      </View>
      <Text style={sx(`flex-1 text-[13px] font-bold ${item.active ? 'text-primaryStrong' : 'text-text'}`)}>
        {item.label}
      </Text>
    </Pressable>
  );
}
