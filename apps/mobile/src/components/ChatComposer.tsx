import { useEffect, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { buildComposerUiState } from '@/composerUi';
import { Glass } from '@/ui/kit';
import { MobileIcon } from './MobileIcon';

interface ChatComposerProps {
  readonly text: string;
  readonly inputResetKey: number;
  readonly sending: boolean;
  readonly compacting: boolean;
  readonly autoApprove: boolean;
  readonly readOnly?: boolean;
  readonly voicePhase: 'idle' | 'recording' | 'transcribing' | 'error';
  readonly voiceError: string | null;
  readonly attachmentCount: number;
  readonly hidden: boolean;
  readonly onChangeHidden: (hidden: boolean) => void;
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
    compacting: props.compacting,
    actionsOpen: false,
    autoApprove: props.autoApprove,
    attachmentCount: props.attachmentCount,
    voicePhase: props.voicePhase,
    readOnly: props.readOnly,
  });
  const canPressSend = props.sending || ui.canSubmit;
  const recording = ui.voiceTone === 'recording';

  const height = useRef(120);
  const anim = useRef(new Animated.Value(props.hidden ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: props.hidden ? 1 : 0, bounciness: 4, speed: 14, useNativeDriver: true }).start();
  }, [anim, props.hidden]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 24) props.onChangeHidden(true);
        else if (g.dy < -24) props.onChangeHidden(false);
      },
    }),
  ).current;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, height.current - 30)] });
  const onLayout = (e: LayoutChangeEvent) => {
    height.current = e.nativeEvent.layout.height;
  };

  const sendBackground = ui.sendTone === 'danger' ? colors.red : ui.sendTone === 'disabled' ? colors.cardBorderStrong : colors.primary;
  const sendIconColor = ui.sendTone === 'disabled' ? colors.textDim : colors.white;

  return (
    <Animated.View onLayout={onLayout} style={[sx('px-3 pt-1'), { transform: [{ translateY }] }]}>
      {/* Grabber — drag down to minimize, up (or tap) to restore. */}
      <View {...pan.panHandlers} style={sx('items-center', { paddingBottom: 6, paddingTop: 2 })}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.hidden ? 'Show composer' : 'Hide composer'}
          hitSlop={12}
          onPress={() => props.onChangeHidden(!props.hidden)}
          style={sx('rounded-full', { backgroundColor: colors.glassBorder, height: 5, width: 40 })}
        />
      </View>

      <Glass radius={26} intensity={70}>
        {props.voiceError ? (
          <Text style={sx('px-4 pt-2 text-[12px] font-semibold text-red')}>{props.voiceError}</Text>
        ) : null}
        <View style={sx('flex-row px-2 py-2', { alignItems: 'flex-end', gap: 6 })}>
          <RoundButton icon="plus" accessibilityLabel="Open options" iconColor={colors.text} onPress={props.onOpenOptions} />

          <TextInput
            key={`composer-input-${props.inputResetKey}`}
            value={props.text}
            onChangeText={props.onTextChange}
            onFocus={() => props.onChangeHidden(false)}
            multiline
            autoCapitalize="sentences"
            autoCorrect
            placeholder={ui.placeholder}
            placeholderTextColor={colors.textDim}
            editable={!ui.disabled}
            style={sx('flex-1 text-text', { fontSize: 16, lineHeight: 22, maxHeight: 120, minHeight: 40, paddingHorizontal: 4, paddingVertical: 9 })}
          />

          <RoundButton
            icon="mic"
            accessibilityLabel={recording ? 'Stop recording' : 'Voice input'}
            iconColor={recording ? colors.primaryStrong : colors.textMuted}
            tinted={recording ? colors.primarySoft : undefined}
            onPress={props.onVoice}
          />

          <Pressable
            accessibilityLabel={props.sending ? 'Stop response' : 'Send message'}
            accessibilityRole="button"
            disabled={!canPressSend}
            hitSlop={6}
            onPress={props.sending ? props.onAbort : props.onSubmit}
            style={sx('items-center justify-center rounded-full', { backgroundColor: sendBackground, height: 40, width: 40 })}
          >
            <MobileIcon name={ui.sendIcon} size={ui.sendIcon === 'send' ? 20 : 16} strokeWidth={2.5} color={sendIconColor} />
          </Pressable>
        </View>
      </Glass>
    </Animated.View>
  );
}

function RoundButton({
  icon,
  accessibilityLabel,
  iconColor,
  tinted,
  onPress,
}: {
  readonly icon: 'plus' | 'mic';
  readonly accessibilityLabel: string;
  readonly iconColor: string;
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
      style={sx('items-center justify-center rounded-full', {
        backgroundColor: tinted ?? colors.glassHighlight,
        borderColor: colors.glassBorder,
        borderWidth: 1,
        height: 40,
        width: 40,
      })}
    >
      <MobileIcon name={icon} size={icon === 'plus' ? 21 : 18} strokeWidth={2.4} color={iconColor} />
    </Pressable>
  );
}
