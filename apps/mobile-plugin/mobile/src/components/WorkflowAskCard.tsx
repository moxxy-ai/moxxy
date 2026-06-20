import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { textOf } from '@/utils/record';
import { MobileIcon } from './MobileIcon';

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
    <View className="gap-3 rounded-card border border-amber bg-cardBg p-3 shadow-card">
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-block bg-primarySoft">
          <MobileIcon name="workflows" size={17} strokeWidth={2.35} color="#d97706" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-bold text-text" numberOfLines={1}>
            {textOf(workflow.workflow, 'Workflow')} is waiting
          </Text>
          <Text className="mt-0.5 text-[12px] leading-4 text-muted" numberOfLines={2}>
            {textOf(workflow.label, textOf(workflow.stepId, 'Input required'))}
          </Text>
        </View>
      </View>
      {prompt ? (
        <ScrollView className="rounded-block border border-cardBorder bg-appBg" style={{ maxHeight: 150 }}>
          <Text className="p-3 text-[12px] leading-5 text-text">{prompt}</Text>
        </ScrollView>
      ) : null}
      <TextInput
        value={reply}
        onChangeText={setReply}
        multiline
        placeholder="Type your reply..."
        placeholderTextColor="#94a3b8"
        className="min-h-20 rounded-block border border-cardBorder bg-cardBg px-3 py-2 text-[14px] leading-5 text-text"
      />
      <View className="flex-row justify-end">
        <Pressable
          accessibilityLabel="Send workflow reply"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          className={`min-h-9 justify-center rounded-block border border-primary bg-primary px-4 ${canSend ? '' : 'opacity-50'}`}
          disabled={!canSend}
          onPress={() => onRespond({ text: reply.trim() })}
        >
          <Text className="text-[13px] font-bold text-white">Send reply</Text>
        </Pressable>
      </View>
    </View>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
