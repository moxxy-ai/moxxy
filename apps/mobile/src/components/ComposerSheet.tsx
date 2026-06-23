import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
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
  readonly onOpenActions: () => void;
  readonly onGoal: () => void;
  readonly onToggleAutoApprove: () => void;
  readonly onCompact: () => void;
  readonly onNewSession: () => void;
}

export function ComposerSheet(props: ComposerSheetProps) {
  const { colors } = useTheme();
  const [rendered, setRendered] = useState(props.open);
  const translateY = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const heightRef = useRef(440);

  useEffect(() => {
    if (props.open) {
      setRendered(true);
      translateY.setValue(heightRef.current);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, bounciness: 2, speed: 14, useNativeDriver: true }),
        Animated.timing(progress, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: heightRef.current, duration: 200, useNativeDriver: true }),
        Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [props.open]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 90 || g.vy > 0.6) {
          props.onClose();
        } else {
          Animated.spring(translateY, { toValue: 0, bounciness: 2, speed: 16, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    if (e.nativeEvent.layout.height > 0) heightRef.current = e.nativeEvent.layout.height;
  };

  const run = (fn: () => void) => () => {
    props.onClose();
    fn();
  };

  if (!rendered) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={props.onClose}>
      <Animated.View style={[sx('absolute', { bottom: 0, left: 0, right: 0, top: 0 }), { opacity: progress }]}>
        <Pressable accessibilityLabel="Close options" onPress={props.onClose} style={sx('flex-1', { backgroundColor: colors.overlay })} />
      </Animated.View>

      <Animated.View
        onLayout={onLayout}
        style={[sx('absolute', { bottom: 0, left: 0, right: 0 }), { transform: [{ translateY }] }]}
      >
        <Glass radius={28} intensity={80} heavy>
          <SafeAreaView edges={['bottom']}>
            <View {...pan.panHandlers} style={sx('items-center', { paddingBottom: 4, paddingTop: 10 })}>
              <View style={sx('rounded-full', { backgroundColor: colors.textDim, height: 5, opacity: 0.5, width: 40 })} />
            </View>
            <Text style={sx('px-5 pb-1 pt-1 text-[13px] font-black uppercase tracking-wide text-dim')}>Options</Text>

            <View style={sx('px-2 pb-2')}>
              <Row icon="camera" tone="brand" label="Photo or screenshot" onPress={run(props.onPickImage)} />
              <Row icon="folder" tone="info" label="File from phone" onPress={run(props.onPickFile)} />
              <Sep />
              <Row icon="agent" tone="brand" label="Model" value={props.modelLabel} onPress={run(props.onOpenModel)} />
              <Row icon="bolt" tone="warn" label="Mode" value={props.modeLabel} onPress={run(props.onOpenMode)} />
              <Sep />
              <Row icon="actions" tone="info" label="Session actions" onPress={run(props.onOpenActions)} />
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
      </Animated.View>
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
