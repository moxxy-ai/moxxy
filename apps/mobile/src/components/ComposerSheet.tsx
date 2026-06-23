import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, ScrollView, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import type { ModelSelectorUiState } from '../modelSelector';
import type { ModeSelectorUiState } from '../modeSelector';
import { Glass, IconBadge } from '@/ui/kit';
import { MobileIcon, type MobileIconName } from './MobileIcon';

type Page = 'main' | 'model' | 'mode';

interface ComposerSheetProps {
  readonly open: boolean;
  readonly autoApprove: boolean;
  readonly readOnly?: boolean;
  readonly modelUi: ModelSelectorUiState;
  readonly modeUi: ModeSelectorUiState;
  readonly onClose: () => void;
  readonly onPickImage: () => void;
  readonly onPickFile: () => void;
  readonly onSelectProvider: (provider: string) => void;
  readonly onPickModel: (provider: string, model: string | null) => void;
  readonly onPickMode: (mode: string) => void;
  readonly onOpenActions: () => void;
  readonly onGoal: () => void;
  readonly onToggleAutoApprove: () => void;
  readonly onCompact: () => void;
  readonly onNewSession: () => void;
}

export function ComposerSheet(props: ComposerSheetProps) {
  const { colors } = useTheme();
  const { height: screenH } = useWindowDimensions();
  const pageHeight = Math.round(screenH * 0.62);
  const [rendered, setRendered] = useState(props.open);
  const [page, setPage] = useState<Page>('main');
  const translateY = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const heightRef = useRef(440);

  useEffect(() => {
    if (props.open) {
      setRendered(true);
      setPage('main');
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
        if (g.dy > 90 || g.vy > 0.6) props.onClose();
        else Animated.spring(translateY, { toValue: 0, bounciness: 2, speed: 16, useNativeDriver: true }).start();
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

      <Animated.View onLayout={onLayout} style={[sx('absolute', { bottom: 0, left: 0, right: 0 }), { transform: [{ translateY }] }]}>
        <Glass radius={28} intensity={80} heavy>
          <SafeAreaView edges={['bottom']}>
            <View {...pan.panHandlers} style={sx('items-center', { paddingBottom: 4, paddingTop: 10 })}>
              <View style={sx('rounded-full', { backgroundColor: colors.textDim, height: 5, opacity: 0.5, width: 40 })} />
            </View>

            <View style={sx('flex-row items-center px-3 pb-1', { gap: 4, minHeight: 36 })}>
              {page !== 'main' ? (
                <Pressable accessibilityLabel="Back" accessibilityRole="button" hitSlop={8} onPress={() => setPage('main')} style={sx('h-9 w-9 items-center justify-center rounded-full')}>
                  <MobileIcon name="chevronLeft" size={22} strokeWidth={2.5} color={colors.text} />
                </Pressable>
              ) : null}
              <Text style={sx('flex-1 text-[13px] font-black uppercase tracking-wide text-dim', { paddingLeft: page === 'main' ? 8 : 0 })}>
                {page === 'model' ? 'Model' : page === 'mode' ? 'Mode' : 'Options'}
              </Text>
            </View>

            {page === 'main' ? (
              <View style={sx('px-2 pb-2')}>
                <Row icon="camera" tone="brand" label="Photo or screenshot" onPress={run(props.onPickImage)} />
                <Row icon="folder" tone="info" label="File from phone" onPress={run(props.onPickFile)} />
                <Sep />
                <Row icon="agent" tone="brand" label="Model" value={props.modelUi.chipLabel} disabled={props.modelUi.disabled} onPress={() => setPage('model')} />
                <Row icon="bolt" tone="warn" label="Mode" value={props.modeUi.chipLabel} disabled={props.modeUi.disabled} onPress={() => setPage('mode')} />
                <Sep />
                <Row icon="actions" tone="info" label="Session actions" onPress={run(props.onOpenActions)} />
                <Row icon="goals" tone="brand" label="Start a goal" onPress={run(props.onGoal)} />
                <Row icon="bolt" tone={props.autoApprove ? 'success' : 'neutral'} label="Auto-approve tool calls" value={props.autoApprove ? 'On' : 'Off'} showChevron={false} onPress={props.onToggleAutoApprove} />
                <Row icon="refresh" tone="neutral" label="Compact context" onPress={run(props.onCompact)} />
                <Row icon="plus" tone="neutral" label="New chat" onPress={run(props.onNewSession)} />
              </View>
            ) : page === 'model' ? (
              <View style={sx('flex-row px-3 pb-3', { gap: 8, height: pageHeight })}>
                <ScrollView style={{ width: 140 }} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator={false}>
                  {props.modelUi.providerRows.map((provider) => (
                    <PickerRow
                      key={provider.id}
                      label={provider.label}
                      selected={provider.selected}
                      tone="brand"
                      dot={provider.active}
                      onPress={() => props.onSelectProvider(provider.id)}
                    />
                  ))}
                </ScrollView>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator={false}>
                  {props.modelUi.modelRows.map((model) => (
                    <PickerRow
                      key={model.id ?? 'default'}
                      label={model.label}
                      selected={model.active}
                      tone="brand"
                      check={model.active}
                      onPress={() => { props.onPickModel(props.modelUi.selectedProvider, model.id); setPage('main'); }}
                    />
                  ))}
                  {props.modelUi.modelRows.length === 0 ? (
                    <Text style={sx('px-1 py-3 text-[13px] font-semibold text-dim')}>No models advertised.</Text>
                  ) : null}
                </ScrollView>
              </View>
            ) : (
              <ScrollView style={{ height: pageHeight }} contentContainerStyle={sx('px-3 pb-3', { gap: 6 })} showsVerticalScrollIndicator={false}>
                {props.modeUi.modeRows.map((mode) => (
                  <PickerRow
                    key={mode.id}
                    label={mode.label}
                    selected={mode.active}
                    tone="warn"
                    check={mode.active}
                    onPress={() => { props.onPickMode(mode.id); setPage('main'); }}
                  />
                ))}
              </ScrollView>
            )}
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
  disabled = false,
}: {
  readonly icon: MobileIconName;
  readonly tone: 'neutral' | 'brand' | 'success' | 'warn' | 'info';
  readonly label: string;
  readonly value?: string;
  readonly onPress: () => void;
  readonly showChevron?: boolean;
  readonly disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => sx('flex-row items-center rounded-2xl px-3', { backgroundColor: pressed ? colors.glassHighlight : 'transparent', gap: 12, minHeight: 52, opacity: disabled ? 0.45 : 1 })}
    >
      <IconBadge icon={icon} tone={tone} size={34} />
      <Text style={sx('flex-1 text-[15px] font-semibold text-text')} numberOfLines={1}>{label}</Text>
      {value ? <Text style={sx('text-[14px] font-semibold text-muted', { flexShrink: 1, maxWidth: '45%', textAlign: 'right' })} numberOfLines={1}>{value}</Text> : null}
      {showChevron && !disabled ? <MobileIcon name="chevronRight" size={16} strokeWidth={2.4} color={colors.textDim} /> : null}
    </Pressable>
  );
}

function PickerRow({
  label,
  selected,
  tone,
  check = false,
  dot = false,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly tone: 'brand' | 'warn';
  readonly check?: boolean;
  readonly dot?: boolean;
  readonly onPress: () => void;
}) {
  const { colors } = useTheme();
  const accent = tone === 'warn' ? colors.amber : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={sx('flex-row items-center rounded-xl px-3', {
        backgroundColor: selected ? colors.primarySoft : colors.inputSoft,
        borderColor: selected ? accent : colors.cardBorder,
        borderWidth: 1,
        gap: 8,
        minHeight: 44,
      })}
    >
      {dot ? <View style={sx('rounded-full', { backgroundColor: colors.green, height: 7, width: 7 })} /> : null}
      <Text style={sx('flex-1 text-[13px] font-bold', { color: selected ? colors.text : colors.textMuted })} numberOfLines={1}>{label}</Text>
      {check ? <MobileIcon name="check" size={15} strokeWidth={2.5} color={accent} /> : null}
    </Pressable>
  );
}

function Sep() {
  const { colors } = useTheme();
  return <View style={{ backgroundColor: colors.glassBorder, height: 1, marginHorizontal: 16, marginVertical: 4 }} />;
}
