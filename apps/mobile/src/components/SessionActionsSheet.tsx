import { sx, mobileInk } from '../styles/tokens';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { MobileSessionActionRow } from '../sessionActions';
import { GlassSheet, SheetCloseButton } from './primitives/GlassSheet';
import { Gradient } from './primitives/Gradient';
import { PressableScale } from './primitives/motion';

interface SessionActionsSheetProps {
  readonly open: boolean;
  readonly actions: ReadonlyArray<MobileSessionActionRow>;
  readonly allActionsCount: number;
  readonly filter: string;
  readonly error: string | null;
  readonly readOnly: boolean;
  readonly argsFor: MobileSessionActionRow | null;
  readonly argValues: Readonly<Record<string, string>>;
  readonly onFilterChange: (value: string) => void;
  readonly onSelectAction: (action: MobileSessionActionRow) => void;
  readonly onArgValueChange: (id: string, value: string) => void;
  readonly onRunArgsAction: () => void;
  readonly onBackToList: () => void;
  readonly onClose: () => void;
}

export function SessionActionsSheet(props: SessionActionsSheetProps) {
  if (!props.open) return null;

  return (
    <View style={styles.overlay}>
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel="Close session actions"
        style={styles.backdrop}
        onPress={props.onClose}
      />
      <GlassSheet radius={22} style={styles.card}>
        {props.argsFor ? <ArgsView {...props} action={props.argsFor} /> : <ListView {...props} />}
      </GlassSheet>
    </View>
  );
}

function ListView(props: SessionActionsSheetProps) {
  return (
    <View style={{ gap: 14 }}>
      <View style={sx('flex-row items-center justify-between gap-3')}>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[22px] font-black', { color: mobileInk.strong })}>Actions</Text>
          <Text style={sx('mt-1 text-[12px] font-bold', { color: mobileInk.soft })}>
            {props.allActionsCount} available for this session
          </Text>
        </View>
        <SheetCloseButton label="Close actions" onPress={props.onClose} />
      </View>

      <TextInput
        accessibilityLabel="Filter actions"
        value={props.filter}
        onChangeText={props.onFilterChange}
        placeholder="Filter actions..."
        placeholderTextColor={mobileInk.faint}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />

      {props.error ? (
        <View style={styles.errorBox}>
          <Text style={sx('text-[12px] font-semibold text-red')}>{props.error}</Text>
        </View>
      ) : null}

      <ScrollView style={{ maxHeight: 410 }} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
        {props.actions.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            disabled={props.readOnly}
            onPress={() => props.onSelectAction(action)}
          />
        ))}
        {props.actions.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={sx('text-[14px] font-black', { color: mobileInk.strong })}>No actions match</Text>
            <Text style={sx('mt-1 text-[12px] font-semibold', { color: mobileInk.soft })}>Try a shorter filter.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ArgsView(props: SessionActionsSheetProps & { readonly action: MobileSessionActionRow }) {
  const canRun = props.action.args.every((arg) => (props.argValues[arg.id] ?? '').trim().length > 0);
  return (
    <View style={{ gap: 14 }}>
      <View style={sx('flex-row items-center justify-between gap-3')}>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[22px] font-black', { color: mobileInk.strong })}>{props.action.label}</Text>
          <Text style={sx('mt-1 text-[12px] font-semibold', { color: mobileInk.soft })} numberOfLines={2}>
            {props.action.description}
          </Text>
        </View>
        <SheetCloseButton label="Close action arguments" onPress={props.onClose} />
      </View>

      <ScrollView style={{ maxHeight: 330 }} contentContainerStyle={{ gap: 12, paddingBottom: 2 }}>
        {props.action.args.map((arg) => (
          <View key={arg.id} style={{ gap: 6 }}>
            <Text style={sx('text-[12px] font-black uppercase tracking-widest', { color: mobileInk.muted })}>{arg.label}</Text>
            <TextInput
              accessibilityLabel={arg.label}
              value={props.argValues[arg.id] ?? ''}
              onChangeText={(value) => props.onArgValueChange(arg.id, value)}
              placeholder={arg.placeholder}
              placeholderTextColor={mobileInk.faint}
              multiline={arg.multiline}
              secureTextEntry={arg.id === 'value'}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.inputArg, { maxHeight: arg.multiline ? 140 : undefined }]}
            />
          </View>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <PressableScale
          accessible
          accessibilityRole="button"
          accessibilityLabel="Back to actions"
          scaleTo={0.97}
          style={styles.backButton}
          onPress={props.onBackToList}
        >
          <Text style={sx('text-[14px] font-black', { color: mobileInk.muted })}>Back</Text>
        </PressableScale>
        <PressableScale
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Run ${props.action.label}`}
          accessibilityState={{ disabled: !canRun || props.readOnly }}
          scaleTo={0.97}
          style={[styles.runButton, canRun && !props.readOnly ? null : { opacity: 0.5 }]}
          disabled={!canRun || props.readOnly}
          onPress={props.onRunArgsAction}
        >
          <Gradient preset="cta" radius={14} style={StyleSheet.absoluteFill} />
          <Text style={sx('text-[14px] font-black', { color: mobileInk.onBrand })}>Run action</Text>
        </PressableScale>
      </View>
    </View>
  );
}

function ActionRow({
  action,
  disabled,
  onPress,
}: {
  readonly action: MobileSessionActionRow;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const toneColors =
    action.tone === 'destructive'
      ? { bg: '#fff1f2', border: '#fecdd3', text: '#ef4444' }
      : action.tone === 'attention'
        ? { bg: '#fff7ed', border: '#fed7aa', text: '#f59e0b' }
        : { bg: 'rgba(255,255,255,0.75)', border: 'rgba(226,228,240,0.9)', text: mobileInk.strong };

  return (
    <PressableScale
      accessibilityLabel={`Run ${action.label}`}
      accessibilityRole="button"
      disabled={disabled}
      scaleTo={0.98}
      style={[
        styles.actionRow,
        {
          backgroundColor: toneColors.bg,
          borderColor: toneColors.border,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={sx('text-[16px] font-black', { color: toneColors.text })} numberOfLines={1}>
            {action.label}
          </Text>
          <Text style={sx('mt-1 text-[12px] font-semibold leading-4', { color: mobileInk.soft })} numberOfLines={2}>
            {action.description}
          </Text>
        </View>
        {action.args.length > 0 ? (
          <View style={styles.argsBadge}>
            <Text style={sx('text-[10px] font-black uppercase text-primaryStrong')}>Args</Text>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 66,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  argsBadge: {
    backgroundColor: '#fdf2f8',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  backdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  card: {
    maxHeight: '100%',
    padding: 16,
  },
  emptyBox: {
    backgroundColor: 'rgba(248,250,252,0.85)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: {
    backgroundColor: 'rgba(248,250,252,0.85)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    color: mobileInk.strong,
    fontSize: 16,
    fontWeight: '600',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  inputArg: {
    paddingVertical: 12,
  },
  overlay: {
    bottom: 0,
    left: 0,
    paddingBottom: 96,
    paddingHorizontal: 16,
    paddingTop: 76,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 70,
  },
  runButton: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    overflow: 'hidden',
  },
});
