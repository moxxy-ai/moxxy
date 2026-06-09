import { Pressable, Text, TextInput, View } from 'react-native';
import { buildComposerUiState } from '@/composerUi';
import { ComposerActionMenu } from './ComposerActionMenu';
import { ContextMeter } from './ContextMeter';
import { MobileIcon } from './MobileIcon';

interface ComposerCardProps {
  readonly text: string;
  readonly sending: boolean;
  readonly compacting: boolean;
  readonly autoApprove: boolean;
  readonly actionsOpen: boolean;
  readonly voicePhase: 'idle' | 'recording' | 'transcribing' | 'error';
  readonly voiceError: string | null;
  readonly readOnly?: boolean;
  readonly usage: Record<string, unknown> | null;
  readonly onTextChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onAbort: () => void;
  readonly onToggleActions: () => void;
  readonly onGoal: () => void;
  readonly onVoice: () => void;
  readonly onToggleAutoApprove: () => void;
  readonly onNewSession: () => void;
  readonly onCompact: () => void;
  readonly onCommand: (name: string, args?: string) => void;
}

export function ComposerCard(props: ComposerCardProps) {
  const ui = buildComposerUiState({
    text: props.text,
    sending: props.sending,
    compacting: props.compacting,
    actionsOpen: props.actionsOpen,
    autoApprove: props.autoApprove,
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
          value={props.text}
          onChangeText={props.onTextChange}
          multiline
          placeholder={ui.placeholder}
          placeholderTextColor="#94a3b8"
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

        <View className="flex-row flex-wrap items-center" style={{ alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 8 }}>
          <Pressable
            accessibilityLabel="Open actions"
            className={ui.actionsTone === 'active' ? 'bg-primarySoft' : 'bg-cardBg'}
            style={{
              alignItems: 'center',
              borderColor: ui.actionsTone === 'active' ? '#ec4899' : '#e3e5f0',
              borderRadius: 10,
              borderWidth: 1,
              height: 38,
              justifyContent: 'center',
              width: 38,
            }}
            onPress={props.onToggleActions}
          >
            <MobileIcon name="plus" size={18} strokeWidth={2.35} color={ui.actionsTone === 'active' ? '#db2777' : '#475569'} />
          </Pressable>

          <Pressable
            accessibilityLabel="Voice input"
            style={{
              alignItems: 'center',
              backgroundColor: ui.voiceTone === 'recording' ? '#fdf2f8' : '#ffffff',
              borderColor: ui.voiceTone === 'neutral' ? '#e3e5f0' : '#ec4899',
              borderRadius: 10,
              borderWidth: 1,
              flexDirection: 'row',
              gap: 6,
              height: 38,
              justifyContent: 'center',
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
              style={{ color: ui.voiceTone === 'neutral' ? '#475569' : '#db2777' }}
            >
              {ui.voiceLabel}
            </Text>
          </Pressable>

          <View style={{ flex: 1, minWidth: 8 }} />
          {ui.statusLabel ? (
            <View
              className="rounded-pill bg-primarySoft"
              style={{ alignItems: 'center', height: 28, justifyContent: 'center', paddingHorizontal: 9 }}
            >
              <Text className="text-[11px] font-bold text-primaryStrong">{ui.statusLabel}</Text>
            </View>
          ) : null}
          <ContextMeter usage={props.usage} />

          <Pressable
            accessibilityLabel={props.sending ? 'Stop response' : 'Send message'}
            disabled={!props.sending && !ui.canSubmit}
            style={{
              alignItems: 'center',
              backgroundColor: sendBackground,
              borderRadius: 12,
              height: 38,
              justifyContent: 'center',
              shadowColor: '#ec4899',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: ui.sendTone === 'disabled' ? 0 : 0.25,
              shadowRadius: 14,
              width: 38,
            }}
            onPress={props.sending ? props.onAbort : props.onSubmit}
          >
            <MobileIcon name={ui.sendIcon} size={17} strokeWidth={2.55} color={sendIconColor} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
