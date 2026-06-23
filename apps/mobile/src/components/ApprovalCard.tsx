import { sx, mobileInk } from '../styles/tokens';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { textOf } from '@/utils/record';
import { MobileIcon } from './MobileIcon';
import { GlassSheet } from './primitives/GlassSheet';
import { Gradient } from './primitives/Gradient';
import { PressableScale } from './primitives/motion';

interface ApprovalCardProps {
  readonly ask: Record<string, unknown>;
  readonly onRespond: (response: Record<string, unknown>) => void;
}

export function ApprovalCard({ ask, onRespond }: ApprovalCardProps) {
  const approval = isRecord(ask.approval) ? ask.approval : ask;
  const options = Array.isArray(approval.options) ? approval.options.filter(isRecord) : [];
  const [textOption, setTextOption] = useState<Record<string, unknown> | null>(null);
  const [text, setText] = useState('');

  if (textOption) {
    return (
      <GlassSheet radius={20} style={styles.sheet}>
        <Text style={sx('text-[15px] font-bold', { color: mobileInk.strong })}>{textOf(textOption.label, 'Respond')}</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder={textOf(textOption.textPrompt, 'Add details...')}
          placeholderTextColor={mobileInk.faint}
          style={styles.input}
        />
        <View style={sx('flex-row justify-end gap-2')}>
          <Button label="Back" onPress={() => setTextOption(null)} />
          <Button
            label={textOf(textOption.label, 'Send')}
            primary
            disabled={text.trim().length === 0}
            onPress={() => onRespond({ optionId: textOf(textOption.id), text: text.trim() })}
          />
        </View>
      </GlassSheet>
    );
  }

  const bodyText = textOf(approval.body, textOf(approval.message, textOf(approval.description, textOf(approval.reason))));

  return (
    <GlassSheet radius={20} style={styles.sheet}>
      <View style={sx('flex-row items-start gap-3')}>
        <Gradient preset="brand" radius={12} style={styles.iconBadge}>
          <MobileIcon name="actions" size={17} strokeWidth={2.35} color="#ffffff" />
        </Gradient>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[15px] font-bold', { color: mobileInk.strong })}>{textOf(approval.title, 'Approval required')}</Text>
          <Text style={sx('mt-0.5 text-[12px] leading-4', { color: mobileInk.soft })}>The current turn is waiting for your decision.</Text>
        </View>
      </View>
      <View>
        {bodyText ? (
          <ScrollView style={styles.bodyBox}>
            <Text style={sx('p-3 text-[12px] leading-5', { color: mobileInk.strong })}>{bodyText}</Text>
          </ScrollView>
        ) : null}
      </View>
      <View style={sx('flex-row flex-wrap justify-end gap-2')}>
        {options.length > 0 ? (
          options.map((option, index) => (
            <Button
              key={textOf(option.id, `option-${index}`)}
              label={textOf(option.label, 'Choose')}
              primary={option.id === approval.defaultOptionId}
              danger={option.danger === true}
              onPress={() => {
                if (option.requestsText === true) setTextOption(option);
                else onRespond({ optionId: textOf(option.id) });
              }}
            />
          ))
        ) : (
          <>
            <Button label="Deny" danger onPress={() => onRespond({ mode: 'deny' })} />
            <Button label="Allow session" primary onPress={() => onRespond({ mode: 'allow_session' })} />
          </>
        )}
      </View>
    </GlassSheet>
  );
}

function Button({
  label,
  primary,
  danger,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly primary?: boolean;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      scaleTo={0.94}
      style={[
        styles.button,
        primary ? styles.buttonPrimary : danger ? styles.buttonDanger : styles.buttonNeutral,
        disabled ? { opacity: 0.5 } : null,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      {primary ? <Gradient preset="cta" radius={14} style={StyleSheet.absoluteFill} /> : null}
      <Text
        style={[
          sx('text-[13px] font-bold'),
          { color: primary ? mobileInk.onBrand : danger ? '#ef4444' : mobileInk.muted },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const styles = StyleSheet.create({
  bodyBox: {
    backgroundColor: 'rgba(248,250,252,0.85)',
    borderColor: 'rgba(226,228,240,0.85)',
    borderRadius: 14,
    borderWidth: 1,
    maxHeight: 150,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    overflow: 'hidden',
    paddingHorizontal: 14,
  },
  buttonDanger: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(254,205,211,0.95)',
    borderWidth: 1,
  },
  buttonNeutral: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderWidth: 1,
  },
  buttonPrimary: {
    minWidth: 110,
  },
  iconBadge: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  input: {
    backgroundColor: 'rgba(248,250,252,0.85)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    color: mobileInk.strong,
    fontSize: 14,
    minHeight: 96,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sheet: {
    gap: 12,
    padding: 14,
  },
});
