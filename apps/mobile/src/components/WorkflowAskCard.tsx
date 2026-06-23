import { sx, mobileInk, mobileSurface } from '../styles/tokens';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { textOf } from '@/utils/record';
import { MobileIcon } from './MobileIcon';
import { GlassSheet } from './primitives/GlassSheet';
import { PressableScale } from './primitives/motion';

const AMBER = '#d97706';
const AMBER_SOFT = '#fffaf0';
const AMBER_BORDER = '#fcd9a8';

interface WorkflowAskCardProps {
  readonly ask: Record<string, unknown>;
  readonly onRespond: (response: Record<string, unknown>) => void;
}

export function WorkflowAskCard({ ask, onRespond }: WorkflowAskCardProps) {
  const workflow = isRecord(ask.workflow) ? ask.workflow : ask;
  const [reply, setReply] = useState('');
  const prompt = textOf(workflow.prompt);
  const canSend = reply.trim().length > 0;

  return (
    <GlassSheet radius={20} style={styles.sheet}>
      <View style={sx('flex-row items-start gap-3')}>
        <View style={styles.iconBadge}>
          <MobileIcon name="workflows" size={18} strokeWidth={2.4} color={AMBER} />
        </View>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[15px] font-black', { color: mobileInk.strong })} numberOfLines={1}>
            {textOf(workflow.workflow, 'Workflow')} is waiting
          </Text>
          <Text style={sx('mt-0.5 text-[12px] font-semibold leading-4', { color: mobileInk.soft })} numberOfLines={2}>
            {textOf(workflow.label, textOf(workflow.stepId, 'Input required'))}
          </Text>
        </View>
      </View>
      {prompt ? (
        <ScrollView style={styles.promptBox}>
          <Text style={sx('p-3 text-[12px] leading-5', { color: mobileInk.strong })}>{prompt}</Text>
        </ScrollView>
      ) : null}
      <TextInput
        value={reply}
        onChangeText={setReply}
        multiline
        placeholder="Type your reply..."
        placeholderTextColor={mobileInk.faint}
        style={styles.input}
      />
      <View style={sx('flex-row justify-end')}>
        <PressableScale
          accessibilityLabel="Send workflow reply"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          scaleTo={0.94}
          style={[styles.sendButton, canSend ? null : { opacity: 0.5 }]}
          disabled={!canSend}
          onPress={() => onRespond({ text: reply.trim() })}
        >
          <MobileIcon name="send" size={15} strokeWidth={2.5} color="#ffffff" />
          <Text style={sx('text-[13px] font-bold', { color: mobileInk.onBrand })}>Send reply</Text>
        </PressableScale>
      </View>
    </GlassSheet>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const styles = StyleSheet.create({
  iconBadge: {
    alignItems: 'center',
    backgroundColor: AMBER_SOFT,
    borderColor: AMBER_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    flexShrink: 0,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  input: {
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 14,
    borderWidth: 1,
    color: mobileInk.strong,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 80,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  promptBox: {
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 14,
    borderWidth: 1,
    maxHeight: 150,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: AMBER,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  sheet: {
    borderColor: AMBER_BORDER,
    gap: 12,
    padding: 14,
  },
});
