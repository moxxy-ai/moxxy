import { Pressable, ScrollView, Text, View } from 'react-native';
import { useState } from 'react';
import type { AssistantTranscriptItem, SystemGroupTranscriptItem, ToolGroupTranscriptItem, TranscriptItem } from '@/chatTranscript';
import { MobileIcon } from './MobileIcon';
import { ThinkingIndicator } from './ThinkingIndicator';

interface ChatListProps {
  readonly items: ReadonlyArray<TranscriptItem>;
  readonly sending?: boolean;
}

export function ChatList({ items, sending = false }: ChatListProps) {
  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 px-5 pb-5 pt-20"
      contentContainerStyle={{ gap: 16, paddingBottom: 20, paddingHorizontal: 20, paddingTop: 82 }}
    >
      {items.length === 0 ? (
        <View className="mt-20">
          <Text className="text-[27px] font-black leading-9 text-text">Moxxy Mobile</Text>
          <Text className="mt-3 text-[16px] leading-7 text-muted">
            Wybierz sesję z menu albo napisz wiadomość, żeby sterować tym samym runtime z telefonu.
          </Text>
        </View>
      ) : null}
      {items.map((item) => (
        <MessageBlock key={item.id} item={item} />
      ))}
      {sending && items.every((item) => item.kind !== 'assistant' || !item.streaming) ? <ThinkingIndicator /> : null}
    </ScrollView>
  );
}

function MessageBlock({ item }: { readonly item: TranscriptItem }) {
  if (item.kind === 'user') {
    return (
      <View
        testID="mobile-user-block"
        style={{
          alignSelf: 'flex-end',
          backgroundColor: '#ec4899',
          borderBottomLeftRadius: 16,
          borderBottomRightRadius: 4,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          maxWidth: '82%',
          paddingHorizontal: 16,
          paddingVertical: 12,
          shadowColor: '#ec4899',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.2,
          shadowRadius: 14,
        }}
      >
        <Text className="text-[15px] leading-6 text-white">{item.text}</Text>
      </View>
    );
  }

  if (item.kind === 'assistant') {
    return <AssistantMessage message={item} />;
  }

  if (item.kind === 'tool-group') {
    return <ToolGroupMessage group={item} />;
  }

  if (item.kind === 'system-group') {
    return <SystemGroupMessage group={item} />;
  }

  return (
    <View
      className="rounded-block border border-cardBorder bg-cardBg"
      style={{
        alignSelf: 'center',
        borderColor: '#fecaca',
        borderRadius: 10,
        borderWidth: 1,
        maxWidth: '92%',
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text className="text-[12px] font-bold text-red">{item.label}</Text>
      <Text className="mt-1 text-[13px] leading-5 text-muted">{item.text}</Text>
    </View>
  );
}

function AssistantMessage({ message }: { readonly message: AssistantTranscriptItem }) {
  return (
    <View
      testID="mobile-assistant-block"
      style={{ alignSelf: 'stretch', flexDirection: 'row', gap: 12, maxWidth: '96%' }}
    >
      <View
        className="bg-primarySoft"
        style={{ alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', width: 34 }}
      >
        <MobileIcon name="message" size={18} strokeWidth={2.35} color="#db2777" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
          <Text className="text-[13px] font-bold text-text">{message.label}</Text>
          {message.streaming ? (
            <View className="rounded-pill bg-primarySoft px-2 py-0.5">
              <Text className="text-[11px] font-bold text-primary">typing...</Text>
            </View>
          ) : null}
        </View>
        <Text className="mt-1 text-[15px] leading-6 text-text">{message.text}</Text>
        {!message.streaming && message.stopReason && message.stopReason !== 'end_turn' ? (
          <Text className="mt-1 text-[10px] font-bold uppercase text-dim">stop: {message.stopReason.replace(/_/g, ' ')}</Text>
        ) : null}
      </View>
    </View>
  );
}

function ToolGroupMessage({ group }: { readonly group: ToolGroupTranscriptItem }) {
  const [open, setOpen] = useState(false);
  const hasError = group.tools.some((tool) => tool.status === 'error');
  const running = group.tools.some((tool) => tool.status === 'running');
  const accent = hasError ? '#ef4444' : running ? '#ec4899' : '#16a34a';
  const tint = hasError ? '#fee2e2' : running ? '#fdf2f8' : '#ecfdf5';

  return (
    <View
      style={{
        alignSelf: 'stretch',
        flexDirection: 'row',
        gap: 12,
        maxWidth: '96%',
      }}
    >
      <View
        style={{ alignItems: 'center', backgroundColor: tint, borderRadius: 10, height: 34, justifyContent: 'center', width: 34 }}
      >
        <MobileIcon name="bolt" size={17} strokeWidth={2.35} color={accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={{ alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 34 }}
        >
          <Text className="text-[13px] font-bold text-text">{group.title}</Text>
          <Text className="text-[11px] font-bold text-dim">{group.tools.length}</Text>
          <Text className="flex-1 text-[11px] font-medium text-dim" numberOfLines={1}>
            {group.summary}
          </Text>
          <Text className="text-[16px] font-bold text-dim">{open ? '-' : '+'}</Text>
        </Pressable>
        {open ? (
          <View className="mt-2 overflow-hidden rounded-block border border-cardBorder bg-cardBg">
            {group.tools.map((tool, index) => (
              <View
                key={tool.id}
                style={{
                  borderTopColor: '#e3e5f0',
                  borderTopWidth: index === 0 ? 0 : 1,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                }}
              >
                <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
                  <View
                    style={{
                      backgroundColor: statusColor(tool.status),
                      borderRadius: 999,
                      height: 7,
                      width: 7,
                    }}
                  />
                  <Text className="text-[12px] font-bold text-text">{tool.name}</Text>
                  <Text className="text-[11px] font-bold text-dim">{statusLabel(tool.status)}</Text>
                </View>
                {tool.summary ? (
                  <Text className="mt-1 text-[11px] leading-4 text-muted" numberOfLines={2}>
                    {tool.summary}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SystemGroupMessage({ group }: { readonly group: SystemGroupTranscriptItem }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ alignSelf: 'stretch', flexDirection: 'row', gap: 12, maxWidth: '96%' }}>
      <View className="h-[34px] w-[34px] items-center justify-center rounded-block bg-appBg">
        <MobileIcon name="more" size={17} strokeWidth={2.35} color="#94a3b8" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={{ alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 34 }}
        >
          <Text className="text-[12px] font-bold text-muted">{group.title}</Text>
          <Text className="text-[11px] font-bold text-dim">{group.count} events</Text>
          <Text className="flex-1 text-[11px] text-dim" numberOfLines={1}>
            collapsed
          </Text>
          <Text className="text-[16px] font-bold text-dim">{open ? '-' : '+'}</Text>
        </Pressable>
        {open ? (
          <View className="mt-2 rounded-block border border-cardBorder bg-cardBg px-3 py-2">
            {group.events.map((event) => (
              <View key={event.id} className="py-1">
                <Text className="text-[11px] font-bold text-muted">{event.type}</Text>
                <Text className="text-[11px] leading-4 text-dim">{event.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function statusColor(status: 'running' | 'ok' | 'error'): string {
  if (status === 'ok') return '#16a34a';
  if (status === 'error') return '#ef4444';
  return '#ec4899';
}

function statusLabel(status: 'running' | 'ok' | 'error'): string {
  if (status === 'ok') return 'ok';
  if (status === 'error') return 'failed';
  return 'running';
}
