import { sx, mobileInk } from '../styles/tokens';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { textOf } from '@/utils/record';
import { MobileIcon } from './MobileIcon';
import { GlassSheet } from './primitives/GlassSheet';
import { Gradient } from './primitives/Gradient';
import { PressableScale } from './primitives/motion';

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
          <MobileIcon name="workflows" size={17} strokeWidth={2.35} color="#d97706" />
        </View>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[15px] font-bold', { color: mobileInk.strong })} numberOfLines={1}>
            {textOf(workflow.workflow, 'Workflow')} is waiting
          </Text>
          <Text style={sx('mt-0.5 text-[12px] leading-4', { color: mobileInk.soft })} numberOfLines={2}>
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
          <Gradient
            direction="horizontal"
            radius={14}
            stops={[
              { offset: 0, color: '#f59e0b' },
              { offset: 1, color: '#d97706' },
            ]}
            style={StyleSheet.absoluteFill}
          />
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
    backgroundColor: '#fffbeb',
    borderColor: 'rgba(245,158,11,0.45)',
    borderRadius: 12,
    borderWidth: 1,
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
    lineHeight: 20,
    minHeight: 80,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  promptBox: {
    backgroundColor: 'rgba(248,250,252,0.85)',
    borderColor: 'rgba(226,228,240,0.85)',
    borderRadius: 14,
    borderWidth: 1,
    maxHeight: 150,
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    overflow: 'hidden',
    paddingHorizontal: 18,
  },
  sheet: {
    borderColor: 'rgba(245,158,11,0.4)',
    gap: 12,
    padding: 14,
  },
});
