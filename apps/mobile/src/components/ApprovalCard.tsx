import { sx } from '../styles/tokens';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { textOf } from '@/utils/record';
import { useTheme } from '@/theme/ThemeProvider';
import { MobileIcon } from './MobileIcon';

interface ApprovalCardProps {
  readonly ask: Record<string, unknown>;
  readonly onRespond: (response: Record<string, unknown>) => void;
}

export function ApprovalCard({ ask, onRespond }: ApprovalCardProps) {
  const { colors } = useTheme();
  const approval = isRecord(ask.approval) ? ask.approval : ask;
  const options = Array.isArray(approval.options) ? approval.options.filter(isRecord) : [];
  const [textOption, setTextOption] = useState<Record<string, unknown> | null>(null);
  const [text, setText] = useState('');

  if (textOption) {
    return (
      <View style={sx('gap-3 rounded-card border border-cardBorder bg-cardBg p-3 shadow-card')}>
        <Text style={sx('text-[15px] font-bold text-text')}>{textOf(textOption.label, 'Respond')}</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder={textOf(textOption.textPrompt, 'Add details...')}
          placeholderTextColor={colors.textDim}
          style={sx('min-h-24 rounded-block border border-cardBorder bg-cardBg px-3 py-2 text-[14px] text-text')}
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
      </View>
    );
  }

  return (
    <View style={sx('gap-3 rounded-card border border-cardBorder bg-cardBg p-3 shadow-card')}>
      <View style={sx('flex-row items-start gap-3')}>
        <View style={sx('h-9 w-9 items-center justify-center rounded-block bg-primarySoft')}>
          <MobileIcon name="actions" size={17} strokeWidth={2.35} color={colors.primaryStrong} />
        </View>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[15px] font-bold text-text')}>{textOf(approval.title, 'Approval required')}</Text>
          <Text style={sx('mt-0.5 text-[12px] leading-4 text-muted')}>The current turn is waiting for your decision.</Text>
        </View>
      </View>
      <View>
        {textOf(approval.body, textOf(approval.message, textOf(approval.description, textOf(approval.reason)))) ? (
          <ScrollView style={sx('rounded-block border border-cardBorder bg-appBg', { maxHeight: 150 })}>
            <Text style={sx('p-3 text-[12px] leading-5 text-text')}>
              {textOf(approval.body, textOf(approval.message, textOf(approval.description, textOf(approval.reason))))}
            </Text>
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
    </View>
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
  const bg = primary ? 'bg-primary border-primary' : 'bg-cardBg border-cardBorder';
  const color = primary ? 'text-white' : danger ? 'text-red' : 'text-muted';
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      style={sx(`min-h-9 justify-center rounded-block border px-3 ${bg} ${disabled ? 'opacity-50' : ''}`)}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={sx(`text-[13px] font-bold ${color}`)}>{label}</Text>
    </Pressable>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
