import { sx, mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import { StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { summarizeAttachment } from '@/attachments';
import { buildComposerUiState } from '@/composerUi';
import type { PromptAttachment } from '@/clientFrames';
import { useComposerToolbarLayout } from '@/hooks/useComposerToolbarLayout';
import type { ModeSelectorUiState } from '../modeSelector';
import { ComposerActionMenu } from './ComposerActionMenu';
import { ContextMeter } from './ContextMeter';
import { MobileIcon } from './MobileIcon';
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
  const actionsActive = ui.actionsTone === 'active';
  const voiceActive = ui.voiceTone !== 'neutral';
  const handleLayout = (event: LayoutChangeEvent): void => {
    props.onHeightChange?.(event.nativeEvent.layout.height);
  };

  return (
    <View style={sx('relative z-30 px-3 pb-3 pt-2')} onLayout={handleLayout}>
      <ComposerActionMenu
        open={props.actionsOpen}
        autoApprove={props.autoApprove}
        modelLabel={props.modelLabel}
        modeLabel={props.modeLabel}
        modeAttention={Boolean(props.modeBanner)}
        onToggleOpen={props.onToggleActions}
        onOpenModelSelector={props.onOpenModelSelector}
        onOpenModeSelector={props.onOpenModeSelector}
        onGoal={props.onGoal}
        onToggleAutoApprove={props.onToggleAutoApprove}
        onNewSession={props.onNewSession}
        onCompact={props.onCompact}
        onPickImage={props.onPickImage}
        onPickFile={props.onPickFile}
        onCommand={props.onCommand}
      />

      <View style={[styles.frame, bypass ? styles.frameBypass : null]}>
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
        {props.modeBanner ? <ModeStatusBanner banner={props.modeBanner} /> : null}

        <View style={styles.inputRow}>
          <RoundButton
            icon="plus"
            accessibilityLabel="Open actions, model and mode"
            active={actionsActive}
            hitSlop={toolbar.iconHitSlop}
            onPress={props.onToggleActions}
          />
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
          <RoundButton
            icon="mic"
            accessibilityLabel="Voice input"
            active={voiceActive}
            hitSlop={toolbar.iconHitSlop}
            onPress={props.onVoice}
          />
          <SendButton
            tone={ui.sendTone}
            icon={ui.sendIcon}
            hitSlop={toolbar.iconHitSlop}
            disabled={!props.sending && !ui.canSubmit}
            onPress={props.sending ? props.onAbort : props.onSubmit}
            accessibilityLabel={props.sending ? 'Stop response' : 'Send message'}
          />
        </View>

        {props.voiceError ? (
          <Text style={sx('mt-1.5 px-1 text-[12px] font-semibold text-red')}>{props.voiceError}</Text>
        ) : null}
        {props.attachmentError ? (
          <Text style={sx('mt-1.5 px-1 text-[12px] font-semibold text-red')}>{props.attachmentError}</Text>
        ) : null}

        {ui.statusLabel || toolbar.showContextMeter ? (
          <View style={styles.statusRow}>
            {ui.statusLabel ? <Text style={styles.statusLabel}>{ui.statusLabel}</Text> : null}
            {toolbar.showContextMeter ? <ContextMeter usage={props.usage} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function RoundButton({
  icon,
  accessibilityLabel,
  active,
  hitSlop,
  onPress,
}: {
  readonly icon: 'plus' | 'mic';
  readonly accessibilityLabel: string;
  readonly active: boolean;
  readonly hitSlop: number;
  readonly onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={hitSlop}
      scaleTo={0.9}
      style={[
        styles.roundButton,
        active ? styles.roundButtonActive : null,
      ]}
      onPress={onPress}
    >
      <MobileIcon name={icon} size={icon === 'plus' ? 19 : 17} strokeWidth={2.4} color={active ? mobileSurface.accentStrong : mobileInk.muted} />
    </PressableScale>
  );
}

function SendButton({
  tone,
  icon,
  hitSlop,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  readonly tone: 'primary' | 'danger' | 'disabled';
  readonly icon: 'send' | 'stop';
  readonly hitSlop: number;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly accessibilityLabel: string;
}) {
  const background = tone === 'danger' ? '#ef4444' : tone === 'disabled' ? mobileSurface.field : mobileSurface.accent;
  const iconColor = tone === 'disabled' ? mobileInk.faint : '#ffffff';
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={hitSlop}
      scaleTo={0.9}
      style={[styles.sendButton, { backgroundColor: background }]}
      onPress={onPress}
    >
      <MobileIcon name={icon} size={18} strokeWidth={2.5} color={iconColor} />
    </PressableScale>
  );
}

function ModeStatusBanner({ banner }: { readonly banner: ModeBannerState }) {
  const attention = banner.tone === 'attention';
  const accent = attention ? '#b45309' : mobileSurface.accentStrong;
  return (
    <View style={[styles.modeBanner, { borderColor: attention ? '#fcd9a8' : mobileSurface.accentBorder, backgroundColor: attention ? '#fffaf0' : mobileSurface.accentSoft }]}>
      <Text style={[styles.modeBannerLabel, { color: accent }]}>{banner.label}</Text>
      <Text style={styles.modeBannerText}>{banner.description}</Text>
    </View>
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
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 10,
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
  frame: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    ...mobileFlat.floating,
  },
  frameBypass: {
    borderColor: mobileSurface.accent,
  },
  input: {
    color: mobileInk.strong,
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 124,
    minHeight: 40,
    paddingHorizontal: 6,
    paddingVertical: 9,
  },
  inputRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 7,
  },
  modeBanner: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 2,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  modeBannerLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  modeBannerText: {
    color: mobileInk.muted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  roundButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    marginBottom: 2,
    width: 40,
  },
  roundButtonActive: {
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 42,
    justifyContent: 'center',
    marginBottom: 1,
    width: 42,
  },
  statusLabel: {
    color: mobileSurface.accentStrong,
    fontSize: 11,
    fontWeight: '700',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 8,
    paddingHorizontal: 4,
  },
});
