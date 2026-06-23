import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { Glass, IconBadge } from '@/ui/kit';
import { MobileIcon, type MobileIconName } from './MobileIcon';

interface ComposerSheetProps {
  readonly open: boolean;
  readonly autoApprove: boolean;
  readonly modelLabel: string;
  readonly modeLabel: string;
  readonly readOnly?: boolean;
  readonly onClose: () => void;
  readonly onPickImage: () => void;
  readonly onPickFile: () => void;
  readonly onOpenModel: () => void;
  readonly onOpenMode: () => void;
  readonly onGoal: () => void;
  readonly onToggleAutoApprove: () => void;
  readonly onCompact: () => void;
  readonly onNewSession: () => void;
}

export function ComposerSheet(props: ComposerSheetProps) {
  const { colors } = useTheme();
  if (!props.open) return null;

  const run = (fn: () => void) => () => {
    props.onClose();
    fn();
  };

  return (
    <Modal animationType="slide" transparent visible onRequestClose={props.onClose}>
      <Pressable accessibilityLabel="Close options" onPress={props.onClose} style={sx('flex-1', { backgroundColor: colors.overlay })} />
      <View style={sx('absolute', { bottom: 0, left: 0, right: 0 })}>
        <Glass radius={28} intensity={80} heavy>
          <SafeAreaView edges={['bottom']}>
            <View style={sx('items-center', { paddingBottom: 4, paddingTop: 8 })}>
              <View style={sx('rounded-full', { backgroundColor: colors.glassBorder, height: 5, width: 40 })} />
            </View>
            <Text style={sx('px-5 pb-1 pt-1 text-[13px] font-black uppercase tracking-wide text-dim')}>Options</Text>

            <View style={sx('px-2 pb-2')}>
              <Row icon="camera" tone="brand" label="Photo or screenshot" onPress={run(props.onPickImage)} />
              <Row icon="folder" tone="info" label="File from phone" onPress={run(props.onPickFile)} />
              <Sep />
              <Row icon="agent" tone="brand" label="Model" value={props.modelLabel} onPress={run(props.onOpenModel)} />
              <Row icon="bolt" tone="warn" label="Mode" value={props.modeLabel} onPress={run(props.onOpenMode)} />
              <Sep />
              <Row icon="goals" tone="brand" label="Start a goal" onPress={run(props.onGoal)} />
              <Row
                icon="bolt"
                tone={props.autoApprove ? 'success' : 'neutral'}
                label="Auto-approve tool calls"
                value={props.autoApprove ? 'On' : 'Off'}
                showChevron={false}
                onPress={props.onToggleAutoApprove}
              />
              <Row icon="refresh" tone="neutral" label="Compact context" onPress={run(props.onCompact)} />
              <Row icon="plus" tone="neutral" label="New chat" onPress={run(props.onNewSession)} />
            </View>
          </SafeAreaView>
        </Glass>
      </View>
    </Modal>
  );
}

function Row({
  icon,
  tone,
  label,
  value,
  onPress,
  showChevron = true,
}: {
  readonly icon: MobileIconName;
  readonly tone: 'neutral' | 'brand' | 'success' | 'warn' | 'info';
  readonly label: string;
  readonly value?: string;
  readonly onPress: () => void;
  readonly showChevron?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => sx('flex-row items-center rounded-2xl px-3', { backgroundColor: pressed ? colors.glassHighlight : 'transparent', gap: 12, minHeight: 52 })}
    >
      <IconBadge icon={icon} tone={tone} size={34} />
      <Text style={sx('flex-1 text-[15px] font-semibold text-text')} numberOfLines={1}>{label}</Text>
      {value ? <Text style={sx('text-[14px] font-semibold text-muted')} numberOfLines={1}>{value}</Text> : null}
      {showChevron ? <MobileIcon name="chevronRight" size={16} strokeWidth={2.4} color={colors.textDim} /> : null}
    </Pressable>
  );
}

function Sep() {
  const { colors } = useTheme();
  return <View style={{ backgroundColor: colors.glassBorder, height: 1, marginHorizontal: 16, marginVertical: 4 }} />;
}
