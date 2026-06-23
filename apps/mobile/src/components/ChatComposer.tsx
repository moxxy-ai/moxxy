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

const PEEK = 26;

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
  const placeholder = ui.disabled ? ui.placeholder : 'Message moxxy';

  const heightRef = useRef(140);
  const dragY = useRef(new Animated.Value(0)).current;
  const maxHidden = () => Math.max(0, heightRef.current - PEEK);
  // Fade the input box out as it's dragged down so the minimized state reads as
  // empty space (transparent), not a solid bar parked at the bottom.
  const boxOpacity = dragY.interpolate({ inputRange: [0, 72], outputRange: [1, 0], extrapolate: 'clamp' });

  const settle = (hidden: boolean) => {
    Animated.spring(dragY, {
      toValue: hidden ? maxHidden() : 0,
      bounciness: 3,
      speed: 16,
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    settle(props.hidden);
  }, [props.hidden]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        const base = props.hidden ? maxHidden() : 0;
        const next = Math.min(maxHidden(), Math.max(0, base + g.dy));
        dragY.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const next = g.dy > 36 || g.vy > 0.6 ? true : g.dy < -36 || g.vy < -0.6 ? false : props.hidden;
        props.onChangeHidden(next);
        settle(next);
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    heightRef.current = e.nativeEvent.layout.height;
  };

  const sendBackground = ui.sendTone === 'danger' ? colors.red : ui.sendTone === 'disabled' ? colors.cardBorderStrong : colors.primary;
  const sendIconColor = ui.sendTone === 'disabled' ? colors.textDim : colors.white;

  return (
    <Animated.View onLayout={onLayout} style={[sx('px-3'), { transform: [{ translateY: dragY }] }]}>
      {/* Grabber — drag to minimize/restore. */}
      <View {...pan.panHandlers} style={sx('items-center', { paddingBottom: 7, paddingTop: 3 })}>
        <View style={sx('rounded-full', { backgroundColor: colors.textDim, height: 5, opacity: 0.5, width: 38 })} />
      </View>

      <Animated.View style={{ opacity: boxOpacity }} pointerEvents={props.hidden ? 'none' : 'auto'}>
      <Glass radius={28} intensity={70}>
        {props.voiceError ? (
          <Text style={sx('px-4 pt-2 text-[12px] font-semibold text-red')}>{props.voiceError}</Text>
        ) : null}
        <View style={sx('flex-row px-2', { alignItems: 'flex-end', gap: 4, paddingBottom: 7, paddingTop: 6 })}>
          <CircleButton icon="plus" accessibilityLabel="Open options" color={colors.textMuted} onPress={props.onOpenOptions} />

          <TextInput
            key={`composer-input-${props.inputResetKey}`}
            value={props.text}
            onChangeText={props.onTextChange}
            onFocus={() => props.onChangeHidden(false)}
            multiline
            autoCapitalize="sentences"
            autoCorrect
            placeholder={placeholder}
            placeholderTextColor={colors.textDim}
            editable={!ui.disabled}
            style={sx('flex-1 text-text', { fontSize: 16, lineHeight: 21, maxHeight: 118, minHeight: 38, paddingHorizontal: 6, paddingTop: 9, paddingBottom: 8 })}
          />

          <CircleButton
            icon="mic"
            accessibilityLabel={recording ? 'Stop recording' : 'Voice input'}
            color={recording ? colors.primary : colors.textMuted}
            tinted={recording ? colors.primarySoft : undefined}
            onPress={props.onVoice}
          />

          <Pressable
            accessibilityLabel={props.sending ? 'Stop response' : 'Send message'}
            accessibilityRole="button"
            disabled={!canPressSend}
            hitSlop={6}
            onPress={props.sending ? props.onAbort : props.onSubmit}
            style={sx('items-center justify-center rounded-full', { backgroundColor: sendBackground, height: 38, marginLeft: 2, width: 38 })}
          >
            <MobileIcon name={ui.sendIcon} size={ui.sendIcon === 'send' ? 19 : 15} strokeWidth={2.6} color={sendIconColor} />
          </Pressable>
        </View>
      </Glass>
      </Animated.View>
    </Animated.View>
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
