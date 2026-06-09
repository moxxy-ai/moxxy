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
      className="absolute z-20 rounded-card border border-cardBorder bg-cardBg shadow-card"
      style={{
        borderColor: '#e3e5f0',
        borderRadius: 12,
        borderWidth: 1,
        bottom: 126,
        left: 16,
        padding: 4,
        position: 'absolute',
        width: 236,
        zIndex: 20,
      }}
    >
      <View className="flex-row items-center justify-between" style={{ alignItems: 'center', flexDirection: 'row', paddingHorizontal: 6, paddingVertical: 4 }}>
        <Text className="text-[11px] font-black uppercase text-dim">Actions</Text>
        <Pressable accessibilityLabel="Close actions" className="h-9 w-9 items-center justify-center rounded-pill" onPress={props.onToggleOpen}>
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
      className={item.active ? 'bg-primarySoft' : 'bg-transparent'}
      style={{
        alignItems: 'center',
        borderRadius: 8,
        flexDirection: 'row',
        gap: 9,
        minHeight: 40,
        paddingHorizontal: 10,
        width: '100%',
      }}
      onPress={onPress}
    >
      <View
        className={item.active ? 'bg-cardBg' : 'bg-primarySoft'}
        style={{ alignItems: 'center', borderRadius: 8, height: 28, justifyContent: 'center', width: 28 }}
      >
        <MobileIcon name={item.icon} size={15} strokeWidth={2.35} color={item.active ? '#db2777' : '#64748b'} />
      </View>
      <Text className={`flex-1 text-[13px] font-bold ${item.active ? 'text-primaryStrong' : 'text-text'}`}>
        {item.label}
      </Text>
    </Pressable>
  );
}
