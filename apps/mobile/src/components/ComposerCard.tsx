import { sx, mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import { StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { summarizeAttachment } from '@/attachments';
import { buildComposerUiState } from '@/composerUi';
import type { PromptAttachment } from '@/clientFrames';
import { useComposerToolbarLayout } from '@/hooks/useComposerToolbarLayout';
import type { ModeSelectorUiState } from '../modeSelector';
import { ComposerActionMenu } from './ComposerActionMenu';
import { ContextMeter } from './ContextMeter';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { PressableScale } from './primitives/motion';

type ModeBannerState = NonNullable<ModeSelectorUiState['banner']>;

interface ComposerCardProps {
  readonly text: string;
  readonly inputResetKey: number;
  readonly sending: boolean;
  readonly compacting: boolean;
  readonly autoApprove: boolean;
  readonly actionsOpen: boolean;
  readonly voicePhase: 'idle' | 'recording' | 'transcribing' | 'error';
  readonly voiceError: string | null;
  readonly attachments: ReadonlyArray<PromptAttachment>;
  readonly attachmentError: string | null;
  readonly readOnly?: boolean;
  readonly usage: Record<string, unknown> | null;
  readonly modelLabel: string;
  readonly modelDisabled: boolean;
  readonly modeLabel: string;
  readonly modeDisabled: boolean;
  readonly modeBanner: ModeBannerState | null;
  readonly onTextChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onAbort: () => void;
  readonly onToggleActions: () => void;
  readonly onOpenModelSelector: () => void;
  readonly onOpenModeSelector: () => void;
  readonly onGoal: () => void;
  readonly onVoice: () => void;
  readonly onPickImage: () => void;
  readonly onPickFile: () => void;
  readonly onRemoveAttachment: (index: number) => void;
  readonly onToggleAutoApprove: () => void;
  readonly onNewSession: () => void;
  readonly onCompact: () => void;
  readonly onCommand: (name: string, args?: string) => void;
  readonly onHeightChange?: (height: number) => void;
}

export function ComposerCard(props: ComposerCardProps) {
  const toolbar = useComposerToolbarLayout();
  const ui = buildComposerUiState({
    text: props.text,
    sending: props.sending,
    compacting: props.compacting,
    actionsOpen: props.actionsOpen,
    autoApprove: props.autoApprove,
    attachmentCount: props.attachments.length,
    voicePhase: props.voicePhase,
    readOnly: props.readOnly,
  });
  const bypass = ui.frameTone === 'bypass';
  const handleLayout = (event: LayoutChangeEvent): void => {
    props.onHeightChange?.(event.nativeEvent.layout.height);
  };

  return (
    <View style={sx('relative z-30 px-4 pb-3 pt-2')} onLayout={handleLayout}>
      <ComposerActionMenu
        open={props.actionsOpen}
        autoApprove={props.autoApprove}
        onToggleOpen={props.onToggleActions}
        onGoal={props.onGoal}
        onToggleAutoApprove={props.onToggleAutoApprove}
        onNewSession={props.onNewSession}
        onCompact={props.onCompact}
        onPickImage={props.onPickImage}
        onPickFile={props.onPickFile}
        onCommand={props.onCommand}
      />

      <View
        style={[
          styles.frame,
          bypass ? styles.frameBypass : null,
          bypass ? mobileElevation.glow : mobileElevation.md,
        ]}
      >
        <Gradient
          pointerEventsNone
          direction="vertical"
          stops={[
            { offset: 0, color: bypass ? 'rgba(255,255,255,0.7)' : mobileGlass.card.sheen },
            { offset: 1, color: 'rgba(255,255,255,0)' },
          ]}
          style={styles.sheen}
        />
        {props.attachments.length > 0 ? (
          <View style={styles.attachmentRow}>
            {props.attachments.map((attachment, index) => (
              <AttachmentChip
                key={`${attachment.kind}:${attachment.name ?? index}:${index}`}
                attachment={attachment}
                onRemove={() => props.onRemoveAttachment(index)}
              />
            ))}
          </View>
        ) : null}
        {ui.bypassActive ? (
          <View style={styles.bypassBadge}>
            <Gradient preset="cta" radius={999} style={StyleSheet.absoluteFill} />
            <MobileIcon name="bolt" size={14} strokeWidth={2.6} color="#ffffff" />
          </View>
        ) : null}
        {props.modeBanner ? <ModeStatusBanner banner={props.modeBanner} /> : null}
        <TextInput
          key={`composer-input-${props.inputResetKey}`}
          value={props.text}
          onChangeText={props.onTextChange}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={ui.placeholder}
          placeholderTextColor={mobileInk.faint}
          returnKeyType="send"
          editable={!ui.disabled}
          style={styles.input}
        />
        {props.voiceError ? (
          <Text style={sx('mt-1 px-1 text-[12px] font-semibold text-red')}>{props.voiceError}</Text>
        ) : null}
        {props.attachmentError ? (
          <Text style={sx('mt-1 px-1 text-[12px] font-semibold text-red')}>{props.attachmentError}</Text>
        ) : null}

        <View style={styles.pickerRow}>
          <PickerChip
            label="Model"
            value={props.modelLabel}
            disabled={props.modelDisabled}
            accessibilityLabel="Pick provider and model"
            onPress={props.onOpenModelSelector}
          />
          <PickerChip
            label="Mode"
            value={props.modeLabel}
            disabled={props.modeDisabled}
            accent={props.modeBanner ? 'attention' : 'neutral'}
            accessibilityLabel="Pick mode"
            onPress={props.onOpenModeSelector}
          />
        </View>

        <View style={styles.toolbarRow}>
          <PressableScale
            accessibilityLabel="Open actions"
            accessibilityRole="button"
            hitSlop={toolbar.iconHitSlop}
            style={[
              styles.iconButton,
              {
                width: toolbar.actionButtonSize,
                height: toolbar.actionButtonSize,
                backgroundColor: ui.actionsTone === 'active' ? '#fdf2f8' : 'rgba(255,255,255,0.7)',
                borderColor: ui.actionsTone === 'active' ? '#f9a8d4' : 'rgba(226,228,240,0.9)',
              },
            ]}
            onPress={props.onToggleActions}
          >
            <MobileIcon name="plus" size={18} strokeWidth={2.35} color={ui.actionsTone === 'active' ? '#db2777' : mobileInk.muted} />
          </PressableScale>

          <PressableScale
            accessibilityLabel="Voice input"
            accessibilityRole="button"
            style={[
              styles.voiceButton,
              {
                maxWidth: toolbar.voiceMaxWidth,
                backgroundColor: ui.voiceTone === 'recording' ? '#fdf2f8' : 'rgba(255,255,255,0.7)',
                borderColor: ui.voiceTone === 'neutral' ? 'rgba(226,228,240,0.9)' : '#f9a8d4',
              },
            ]}
            onPress={props.onVoice}
          >
            <MobileIcon name="mic" size={16} strokeWidth={2.35} color={ui.voiceTone === 'neutral' ? mobileInk.muted : '#db2777'} />
            <Text
              style={[styles.voiceLabel, { color: ui.voiceTone === 'neutral' ? mobileInk.muted : '#db2777' }]}
              numberOfLines={1}
            >
              {ui.voiceLabel}
            </Text>
          </PressableScale>

          <View style={styles.spacer} />

          <SendButton
            tone={ui.sendTone}
            icon={ui.sendIcon}
            size={toolbar.sendButtonSize}
            hitSlop={toolbar.iconHitSlop}
            disabled={!props.sending && !ui.canSubmit}
            onPress={props.sending ? props.onAbort : props.onSubmit}
            accessibilityLabel={props.sending ? 'Stop response' : 'Send message'}
          />
        </View>

        {ui.statusLabel || toolbar.showContextMeter ? (
          <View style={styles.statusRow}>
            {ui.statusLabel ? (
              <View style={styles.statusPill}>
                <Text style={sx('text-[11px] font-bold text-primaryStrong')}>{ui.statusLabel}</Text>
              </View>
            ) : null}
            {toolbar.showContextMeter ? <ContextMeter usage={props.usage} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SendButton({
  tone,
  icon,
  size,
  hitSlop,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  readonly tone: 'primary' | 'danger' | 'disabled';
  readonly icon: 'send' | 'stop';
  readonly size: number;
  readonly hitSlop: number;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly accessibilityLabel: string;
}) {
  const iconColor = tone === 'disabled' ? mobileInk.faint : '#ffffff';
  const flat = tone === 'danger' ? '#ef4444' : tone === 'disabled' ? '#e6e8f2' : null;
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={hitSlop}
      scaleTo={0.9}
      style={[
        styles.sendButton,
        { width: size, height: size, backgroundColor: flat ?? 'transparent' },
        tone === 'primary' ? mobileElevation.glow : null,
      ]}
      onPress={onPress}
    >
      {tone === 'primary' ? <Gradient preset="cta" radius={13} style={StyleSheet.absoluteFill} /> : null}
      <MobileIcon name={icon} size={17} strokeWidth={2.55} color={iconColor} />
    </PressableScale>
  );
}

function ModeStatusBanner({ banner }: { readonly banner: ModeBannerState }) {
  const accent = banner.tone === 'attention' ? '#f59e0b' : '#06b6d4';
  const soft = banner.tone === 'attention' ? '#fffbeb' : '#ecfeff';
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: soft,
        borderColor: accent,
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
      }}
    >
      <View
        style={{
          alignItems: 'center',
          backgroundColor: accent,
          borderRadius: 999,
          minWidth: 44,
          paddingHorizontal: 8,
          paddingVertical: 3,
        }}
      >
        <Text style={sx('text-[11px] font-black text-white')}>{banner.label}</Text>
      </View>
      <Text style={sx('min-w-0 flex-1 text-[12px] font-bold leading-4 text-text')}>{banner.description}</Text>
    </View>
  );
}

function PickerChip({
  label,
  value,
  disabled,
  accent = 'neutral',
  accessibilityLabel,
  onPress,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly accent?: 'neutral' | 'attention';
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}) {
  const active = accent === 'attention';
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      style={[
        styles.pickerChip,
        {
          backgroundColor: disabled ? '#f1f2f9' : active ? '#fffbeb' : 'rgba(255,255,255,0.78)',
          borderColor: active ? '#f6c659' : 'rgba(226,228,240,0.9)',
          opacity: disabled ? 0.58 : 1,
        },
      ]}
      onPress={onPress}
    >
      <Text style={sx('text-[12px] font-bold text-dim')}>{label}:</Text>
      <Text style={sx('min-w-0 flex-1 text-[12px] font-bold text-text')} numberOfLines={1}>
        {value}
      </Text>
      <MobileIcon name="chevronDown" size={13} strokeWidth={2.5} color={active ? '#f59e0b' : mobileInk.soft} />
    </PressableScale>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  readonly attachment: PromptAttachment;
  readonly onRemove: () => void;
}) {
  const summary = summarizeAttachment(attachment);
  return (
    <View style={styles.attachmentChip}>
      <Text style={sx('text-[11px] font-bold text-muted')}>{summary.detail}</Text>
      <Text style={sx('max-w-[150px] text-[12px] font-bold text-text')} numberOfLines={1}>
        {summary.label}
      </Text>
      <PressableScale
        accessibilityLabel={`Remove ${summary.label}`}
        accessibilityRole="button"
        onPress={onRemove}
        scaleTo={0.85}
        style={{ alignItems: 'center', height: 24, justifyContent: 'center', width: 24 }}
      >
        <MobileIcon name="x" size={13} strokeWidth={2.4} color={mobileInk.soft} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  attachmentChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(248,250,252,0.9)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    maxWidth: '100%',
    minHeight: 30,
    paddingLeft: 9,
    paddingRight: 4,
  },
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  bypassBadge: {
    alignItems: 'center',
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 1.5,
    height: 28,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'absolute',
    right: 12,
    top: -14,
    width: 28,
    zIndex: 2,
  },
  frame: {
    backgroundColor: mobileGlass.card.fill,
    borderColor: mobileGlass.card.border,
    borderRadius: 20,
    borderTopColor: mobileGlass.card.hairline,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  frameBypass: {
    borderColor: '#ec4899',
    borderTopColor: '#f9a8d4',
    borderWidth: 1.5,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
  },
  input: {
    backgroundColor: 'transparent',
    color: mobileInk.strong,
    fontSize: 15,
    lineHeight: 23,
    maxHeight: 132,
    minHeight: 48,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  pickerChip: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 10,
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: 13,
    justifyContent: 'center',
  },
  sheen: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: 40,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  spacer: {
    flex: 1,
    minWidth: 8,
  },
  statusPill: {
    alignItems: 'center',
    backgroundColor: '#fdf2f8',
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  toolbarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  voiceButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: 10,
  },
  voiceLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
});
