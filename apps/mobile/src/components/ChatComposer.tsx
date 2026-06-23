import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { buildComposerUiState } from '@/composerUi';
import { buildChatAttachmentPreview, summarizeAttachment } from '@/attachments';
import type { PromptAttachment } from '@/clientFrames';
import { Glass } from '@/ui/kit';
import { MobileIcon } from './MobileIcon';

interface ChatComposerProps {
  readonly text: string;
  readonly inputResetKey: number;
  readonly sending: boolean;
  /** Whether a turn is in flight (agent working), so the button becomes Stop for
   *  the whole run — not just the brief send round-trip. */
  readonly running: boolean;
  readonly compacting: boolean;
  readonly autoApprove: boolean;
  readonly readOnly?: boolean;
  readonly voicePhase: 'idle' | 'recording' | 'transcribing' | 'error';
  readonly voiceError: string | null;
  readonly attachments: ReadonlyArray<PromptAttachment>;
  readonly attachmentError?: string | null;
  readonly accentBorder?: string;
  readonly onRemoveAttachment: (index: number) => void;
  readonly onTextChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onAbort: () => void;
  readonly onVoice: () => void;
  readonly onOpenOptions: () => void;
}

export function ChatComposer(props: ChatComposerProps) {
  const { colors } = useTheme();
  const ui = buildComposerUiState({
    text: props.text,
    sending: props.sending,
    running: props.running,
    compacting: props.compacting,
    actionsOpen: false,
    autoApprove: props.autoApprove,
    attachmentCount: props.attachments.length,
    voicePhase: props.voicePhase,
    readOnly: props.readOnly,
  });
  const canPressSend = props.running || ui.canSubmit;
  const recording = ui.voiceTone === 'recording';
  const transcribing = props.voicePhase === 'transcribing';
  const placeholder = transcribing
    ? 'Transcribing your voice…'
    : recording
      ? 'Listening…'
      : ui.disabled ? ui.placeholder : 'Message moxxy';
  const sendBackground = ui.sendTone === 'danger' ? colors.red : ui.sendTone === 'disabled' ? colors.cardBorderStrong : colors.primary;
  const sendIconColor = ui.sendTone === 'disabled' ? colors.textDim : colors.white;

  return (
    <View style={sx('px-3', { paddingTop: 8 })}>
      <Glass radius={28} intensity={70} fill={colors.composerFill} borderColor={props.accentBorder} borderWidth={props.accentBorder ? 1.6 : 1}>
        {props.attachments.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={{ marginTop: 10 }}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}
          >
            {props.attachments.map((attachment, index) => (
              <AttachmentPreview
                key={`${attachment.name ?? 'att'}:${index}`}
                attachment={attachment}
                onRemove={() => props.onRemoveAttachment(index)}
              />
            ))}
          </ScrollView>
        ) : null}
        {props.voiceError || props.attachmentError ? (
          <Text style={sx('px-4 pt-2 text-[12px] font-semibold text-red')}>{props.voiceError ?? props.attachmentError}</Text>
        ) : null}
        <View style={sx('flex-row px-2', { alignItems: 'flex-end', gap: 4, paddingBottom: 7, paddingTop: 6 })}>
          <CircleButton icon="plus" accessibilityLabel="Open options" color={colors.textMuted} onPress={props.onOpenOptions} />

          <TextInput
            key={`composer-input-${props.inputResetKey}`}
            value={props.text}
            onChangeText={props.onTextChange}
            multiline
            autoCapitalize="sentences"
            autoCorrect
            placeholder={placeholder}
            placeholderTextColor={colors.textDim}
            editable={!ui.disabled}
            style={sx('flex-1 text-text', { fontSize: 16, lineHeight: 21, maxHeight: 118, minHeight: 38, paddingHorizontal: 6, paddingTop: 9, paddingBottom: 8 })}
          />

          {transcribing ? (
            <View style={sx('items-center justify-center', { height: 38, width: 38 })}>
              <ActivityIndicator color={colors.primary} size="small" />
            </View>
          ) : (
            <CircleButton
              icon="mic"
              accessibilityLabel={recording ? 'Stop recording' : 'Voice input'}
              color={recording ? colors.primary : colors.textMuted}
              tinted={recording ? colors.primarySoft : undefined}
              onPress={props.onVoice}
            />
          )}

          <Pressable
            accessibilityLabel={props.running ? 'Stop response' : 'Send message'}
            accessibilityRole="button"
            disabled={!canPressSend}
            hitSlop={6}
            onPress={props.running ? props.onAbort : props.onSubmit}
            style={sx('items-center justify-center rounded-full', { backgroundColor: sendBackground, height: 38, marginLeft: 2, width: 38 })}
          >
            <MobileIcon name={ui.sendIcon} size={ui.sendIcon === 'send' ? 19 : 15} strokeWidth={2.6} color={sendIconColor} />
          </Pressable>
        </View>
      </Glass>
    </View>
  );
}

function CircleButton({
  icon,
  accessibilityLabel,
  color,
  tinted,
  onPress,
}: {
  readonly icon: 'plus' | 'mic';
  readonly accessibilityLabel: string;
  readonly color: string;
  readonly tinted?: string;
  readonly onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) =>
        sx('items-center justify-center rounded-full', {
          backgroundColor: tinted ?? (pressed ? colors.glassHighlight : 'transparent'),
          height: 38,
          width: 38,
        })
      }
    >
      <MobileIcon name={icon} size={icon === 'plus' ? 22 : 19} strokeWidth={2.3} color={color} />
    </Pressable>
  );
}

function AttachmentPreview({ attachment, onRemove }: { readonly attachment: PromptAttachment; readonly onRemove: () => void }) {
  const { colors } = useTheme();
  const preview = buildChatAttachmentPreview(attachment);
  const summary = summarizeAttachment(attachment);
  return (
    <View style={{ paddingRight: 6, paddingTop: 6 }}>
      {preview ? (
        <Image source={{ uri: preview.uri }} accessibilityLabel={preview.alt} resizeMode="cover" style={sx('rounded-xl', { backgroundColor: colors.surface, height: 54, width: 54 })} />
      ) : (
        <View style={sx('flex-row items-center rounded-xl px-2.5', { backgroundColor: colors.surface, borderColor: colors.cardBorder, borderWidth: 1, gap: 8, height: 54, maxWidth: 188 })}>
          <View style={sx('items-center justify-center rounded-lg', { backgroundColor: colors.primarySoft, height: 32, width: 32 })}>
            <MobileIcon name="folder" size={16} strokeWidth={2.2} color={colors.primary} />
          </View>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text style={sx('text-[12px] font-bold text-text')} numberOfLines={1}>{summary.label}</Text>
            <Text style={sx('text-[11px] font-semibold text-dim')} numberOfLines={1}>{summary.detail}</Text>
          </View>
        </View>
      )}
      <Pressable
        accessibilityLabel="Remove attachment"
        accessibilityRole="button"
        hitSlop={6}
        onPress={onRemove}
        style={sx('absolute items-center justify-center rounded-full', { backgroundColor: colors.text, height: 20, right: 0, top: 0, width: 20 })}
      >
        <MobileIcon name="x" size={12} strokeWidth={2.8} color={colors.appBg} />
      </Pressable>
    </View>
  );
}
