import { Pressable, Text, TextInput, View } from 'react-native';
import { summarizeAttachment } from '@/attachments';
import { buildComposerUiState } from '@/composerUi';
import type { PromptAttachment } from '@/clientFrames';
import { useComposerToolbarLayout } from '@/hooks/useComposerToolbarLayout';
import { ComposerActionMenu } from './ComposerActionMenu';
import { ContextMeter } from './ContextMeter';
import { MobileIcon } from './MobileIcon';

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
  readonly onTextChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onAbort: () => void;
  readonly onToggleActions: () => void;
  readonly onOpenModelSelector: () => void;
  readonly onGoal: () => void;
  readonly onVoice: () => void;
  readonly onPickImage: () => void;
  readonly onPickFile: () => void;
  readonly onRemoveAttachment: (index: number) => void;
  readonly onToggleAutoApprove: () => void;
  readonly onNewSession: () => void;
  readonly onCompact: () => void;
  readonly onCommand: (name: string, args?: string) => void;
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
  const sendBackground = ui.sendTone === 'danger'
    ? '#ef4444'
    : ui.sendTone === 'disabled'
      ? '#e3e5f0'
      : '#ec4899';
  const sendIconColor = ui.sendTone === 'disabled' ? '#94a3b8' : '#ffffff';

  return (
    <View className="relative z-30 px-4 pb-3 pt-2" style={{ paddingBottom: 12, paddingHorizontal: 16, paddingTop: 8 }}>
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
        className="rounded-card border border-cardBorder bg-cardBg shadow-card"
        style={{
          borderColor: ui.frameTone === 'bypass' ? '#ec4899' : '#e3e5f0',
          borderRadius: 16,
          borderWidth: ui.frameTone === 'bypass' ? 2 : 1,
          paddingHorizontal: 12,
          paddingVertical: 10,
          shadowColor: ui.frameTone === 'bypass' ? '#ec4899' : '#0f172a',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: ui.frameTone === 'bypass' ? 0.14 : 0.05,
          shadowRadius: ui.frameTone === 'bypass' ? 22 : 14,
        }}
      >
        {props.attachments.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
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
          <View
            style={{
              alignItems: 'center',
              backgroundColor: '#fdf2f8',
              borderColor: '#ec4899',
              borderRadius: 999,
              borderWidth: 1,
              height: 28,
              justifyContent: 'center',
              position: 'absolute',
              right: 12,
              top: -14,
              width: 28,
              zIndex: 2,
            }}
          >
            <MobileIcon name="bolt" size={14} strokeWidth={2.6} color="#db2777" />
          </View>
        ) : null}
        <TextInput
          key={`composer-input-${props.inputResetKey}`}
          value={props.text}
          onChangeText={props.onTextChange}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={ui.placeholder}
          placeholderTextColor="#94a3b8"
          returnKeyType="send"
          editable={!ui.disabled}
          className="text-text"
          style={{
            backgroundColor: 'transparent',
            color: '#0f172a',
            fontSize: 15,
            lineHeight: 23,
            maxHeight: 132,
            minHeight: 48,
            paddingHorizontal: 4,
            paddingVertical: 4,
          }}
        />
        {props.voiceError ? (
          <Text className="mt-1 px-1 text-[12px] font-semibold text-red">
            {props.voiceError}
          </Text>
        ) : null}
        {props.attachmentError ? (
          <Text className="mt-1 px-1 text-[12px] font-semibold text-red">
            {props.attachmentError}
          </Text>
        ) : null}

        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 8 }}>
          <Pressable
            accessibilityLabel="Open actions"
            accessibilityRole="button"
            className={ui.actionsTone === 'active' ? 'bg-primarySoft' : 'bg-cardBg'}
            hitSlop={toolbar.iconHitSlop}
            style={{
              alignItems: 'center',
              borderColor: ui.actionsTone === 'active' ? '#ec4899' : '#e3e5f0',
              borderRadius: 10,
              borderWidth: 1,
              height: toolbar.actionButtonSize,
              justifyContent: 'center',
              width: toolbar.actionButtonSize,
            }}
            onPress={props.onToggleActions}
          >
            <MobileIcon name="plus" size={18} strokeWidth={2.35} color={ui.actionsTone === 'active' ? '#db2777' : '#475569'} />
          </Pressable>

          <Pressable
            accessibilityLabel="Voice input"
            accessibilityRole="button"
            style={{
              alignItems: 'center',
              backgroundColor: ui.voiceTone === 'recording' ? '#fdf2f8' : '#ffffff',
              borderColor: ui.voiceTone === 'neutral' ? '#e3e5f0' : '#ec4899',
              borderRadius: 10,
              borderWidth: 1,
              flexDirection: 'row',
              gap: 6,
              height: 44,
              justifyContent: 'center',
              maxWidth: toolbar.voiceMaxWidth,
              minWidth: 44,
              paddingHorizontal: 10,
            }}
            onPress={props.onVoice}
          >
            <MobileIcon
              name="mic"
              size={16}
              strokeWidth={2.35}
              color={ui.voiceTone === 'neutral' ? '#475569' : '#db2777'}
            />
            <Text
              className="text-[12px] font-bold"
              numberOfLines={1}
              style={{ color: ui.voiceTone === 'neutral' ? '#475569' : '#db2777' }}
            >
              {ui.voiceLabel}
            </Text>
          </Pressable>

          <Pressable
            accessibilityLabel="Pick provider and model"
            accessibilityRole="button"
            disabled={props.modelDisabled}
            style={{
              alignItems: 'center',
              backgroundColor: props.modelDisabled ? '#f1f2f9' : '#ffffff',
              borderColor: '#e3e5f0',
              borderRadius: 10,
              borderWidth: 1,
              flex: 1,
              flexDirection: 'row',
              gap: 6,
              height: 44,
              justifyContent: 'center',
              maxWidth: toolbar.modelMaxWidth,
              minWidth: toolbar.modelMinWidth,
              opacity: props.modelDisabled ? 0.58 : 1,
              paddingHorizontal: 10,
            }}
            onPress={props.onOpenModelSelector}
          >
            <Text className="text-[12px] font-bold text-dim">Model:</Text>
            <Text className="min-w-0 flex-1 text-[12px] font-bold text-text" numberOfLines={1}>
              {props.modelLabel}
            </Text>
            <MobileIcon name="chevronDown" size={13} strokeWidth={2.5} color="#64748b" />
          </Pressable>

          <Pressable
            accessibilityLabel={props.sending ? 'Stop response' : 'Send message'}
            accessibilityRole="button"
            disabled={!props.sending && !ui.canSubmit}
            hitSlop={toolbar.iconHitSlop}
            style={{
              alignItems: 'center',
              backgroundColor: sendBackground,
              borderRadius: 12,
              height: toolbar.sendButtonSize,
              justifyContent: 'center',
              shadowColor: '#ec4899',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: ui.sendTone === 'disabled' ? 0 : 0.25,
              shadowRadius: 14,
              width: toolbar.sendButtonSize,
            }}
            onPress={props.sending ? props.onAbort : props.onSubmit}
          >
            <MobileIcon name={ui.sendIcon} size={17} strokeWidth={2.55} color={sendIconColor} />
          </Pressable>
        </View>

        {ui.statusLabel || toolbar.showContextMeter ? (
          <View style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
          {ui.statusLabel ? (
            <View
              className="rounded-pill bg-primarySoft"
              style={{ alignItems: 'center', height: 28, justifyContent: 'center', paddingHorizontal: 9 }}
            >
              <Text className="text-[11px] font-bold text-primaryStrong">{ui.statusLabel}</Text>
            </View>
          ) : null}
            {toolbar.showContextMeter ? <ContextMeter usage={props.usage} /> : null}
          </View>
        ) : null}
      </View>
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
    <View
      style={{
        alignItems: 'center',
        backgroundColor: '#f8fafc',
        borderColor: '#e3e5f0',
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 6,
        maxWidth: '100%',
        minHeight: 30,
        paddingLeft: 9,
        paddingRight: 4,
      }}
    >
      <Text className="text-[11px] font-bold text-muted">{summary.detail}</Text>
      <Text className="max-w-[150px] text-[12px] font-bold text-text" numberOfLines={1}>
        {summary.label}
      </Text>
      <Pressable
        accessibilityLabel={`Remove ${summary.label}`}
        accessibilityRole="button"
        onPress={onRemove}
        style={{ alignItems: 'center', height: 24, justifyContent: 'center', width: 24 }}
      >
        <MobileIcon name="x" size={13} strokeWidth={2.4} color="#64748b" />
      </Pressable>
    </View>
  );
}
