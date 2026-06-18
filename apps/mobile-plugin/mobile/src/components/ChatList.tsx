import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ListRenderItem,
} from 'react-native';
import { memo, useCallback, useState } from 'react';
import { summarizeAttachment } from '@/attachments';
import type {
  AssistantTranscriptItem,
  SubagentGroupTranscriptItem,
  SubagentTranscriptItem,
  SystemGroupTranscriptItem,
  ToolGroupTranscriptItem,
  TranscriptItem,
} from '@/chatTranscript';
import type { PromptAttachment } from '@/clientFrames';
import { shouldLoadOlderFromScroll, shouldShowThinkingIndicator } from '@/chatListState';
import { useChatListAutoScroll } from '@/hooks/useChatListAutoScroll';
import { buildMessageActions } from '@/messageActions';
import { buildSubagentDetailUi, selectSubagentDetailAgent } from '@/subagentDetailUi';
import { buildToolDetailUi, buildToolGroupUi, type ToolDetailUi } from '@/toolGroupUi';
import { MobileIcon } from './MobileIcon';
import { ThinkingIndicator } from './ThinkingIndicator';

interface ChatListProps {
  readonly items: ReadonlyArray<TranscriptItem>;
  readonly sending?: boolean;
  readonly hasOlder?: boolean;
  readonly onLoadOlder?: () => void;
  readonly copiedMessageId?: string | null;
  readonly onCopyMessage?: (messageId: string, text: string) => void;
}

export function ChatList({
  items,
  sending = false,
  hasOlder = false,
  onLoadOlder,
  copiedMessageId = null,
  onCopyMessage,
}: ChatListProps) {
  const autoScroll = useChatListAutoScroll(items, sending);
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (
      shouldLoadOlderFromScroll({
        contentOffsetY: event.nativeEvent.contentOffset.y,
        hasOlder,
      })
    ) {
      onLoadOlder?.();
    }
  }, [hasOlder, onLoadOlder]);
  const renderItem = useCallback<ListRenderItem<TranscriptItem>>(({ item }) => (
    <MemoMessageBlock
      item={item}
      copied={copiedMessageId === item.id}
      onCopyMessage={onCopyMessage}
    />
  ), [copiedMessageId, onCopyMessage]);
  const keyExtractor = useCallback((item: TranscriptItem) => item.id, []);
  const empty = useCallback(() => (
    <View className="mt-20">
      <Text className="text-[27px] font-black leading-9 text-text">Moxxy Mobile</Text>
      <Text className="mt-3 text-[16px] leading-7 text-muted">
        Wybierz sesję z menu albo napisz wiadomość, żeby sterować tym samym runtime z telefonu.
      </Text>
    </View>
  ), []);
  const footer = useCallback(
    () => (shouldShowThinkingIndicator({ items, sending }) ? <ThinkingIndicator /> : null),
    [items, sending],
  );

  return (
    <FlatList
      ref={autoScroll.scrollRef}
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      className="flex-1"
      contentContainerStyle={{ gap: 16, paddingBottom: 20, paddingHorizontal: 20, paddingTop: 82 }}
      initialNumToRender={14}
      maxToRenderPerBatch={10}
      onContentSizeChange={autoScroll.handleContentSizeChange}
      onScroll={handleScroll}
      removeClippedSubviews
      scrollEventThrottle={80}
      updateCellsBatchingPeriod={32}
      windowSize={9}
    />
  );
}

function MessageBlock({
  item,
  copied,
  onCopyMessage,
}: {
  readonly item: TranscriptItem;
  readonly copied: boolean;
  readonly onCopyMessage?: (messageId: string, text: string) => void;
}) {
  if (item.kind === 'user') {
    const actions = buildMessageActions(item);
    return (
      <View
        style={{ alignItems: 'flex-end', alignSelf: 'flex-end', flexDirection: 'row', gap: 8, maxWidth: '88%' }}
        testID="mobile-user-message"
      >
        <CopyMessageButton
          copied={copied}
          hidden={!actions.copyText}
          tone="user"
          onPress={() => actions.copyText ? onCopyMessage?.(item.id, actions.copyText) : undefined}
        />
        <View
          testID="mobile-user-block"
          style={{
            backgroundColor: '#ec4899',
            borderBottomLeftRadius: 16,
            borderBottomRightRadius: 4,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            flexShrink: 1,
            maxWidth: '100%',
            paddingHorizontal: 16,
            paddingVertical: 12,
            shadowColor: '#ec4899',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.2,
            shadowRadius: 14,
          }}
        >
          <Text className="text-[15px] leading-6 text-white">{item.text}</Text>
          {item.attachments && item.attachments.length > 0 ? (
            <View style={{ gap: 5, marginTop: item.text.trim().length > 0 ? 10 : 0 }}>
              {item.attachments.map((attachment, index) => (
                <MessageAttachmentChip key={`${attachment.kind}:${attachment.name ?? index}:${index}`} attachment={attachment} />
              ))}
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  if (item.kind === 'assistant') {
    return <AssistantMessage copied={copied} message={item} onCopyMessage={onCopyMessage} />;
  }

  if (item.kind === 'tool-group') {
    return <ToolGroupMessage group={item} />;
  }

  if (item.kind === 'subagent-group') {
    return <SubagentGroupMessage group={item} />;
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

const MemoMessageBlock = memo(MessageBlock);

function MessageAttachmentChip({ attachment }: { readonly attachment: PromptAttachment }) {
  const summary = summarizeAttachment(attachment);
  return (
    <View
      style={{
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderColor: 'rgba(255,255,255,0.28)',
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 6,
        maxWidth: '100%',
        paddingHorizontal: 9,
        paddingVertical: 5,
      }}
    >
      <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '800', opacity: 0.78 }}>{summary.detail}</Text>
      <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '800', maxWidth: 150 }} numberOfLines={1}>
        {summary.label}
      </Text>
    </View>
  );
}

function CopyMessageButton({
  copied,
  hidden,
  tone,
  onPress,
}: {
  readonly copied: boolean;
  readonly hidden: boolean;
  readonly tone: 'assistant' | 'user';
  readonly onPress: () => void;
}) {
  if (hidden) return <View style={{ height: 32, width: 32 }} />;
  const activeColor = copied ? '#16a34a' : tone === 'user' ? '#db2777' : '#64748b';
  return (
    <Pressable
      accessibilityLabel={copied ? 'Message copied' : 'Copy message'}
      accessibilityRole="button"
      onPress={onPress}
      style={{
        alignItems: 'center',
        backgroundColor: copied ? '#ecfdf5' : '#ffffff',
        borderColor: copied ? '#bbf7d0' : '#e3e5f0',
        borderRadius: 999,
        borderWidth: 1,
        height: 32,
        justifyContent: 'center',
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
        width: 32,
      }}
    >
      <MobileIcon name={copied ? 'check' : 'copy'} size={15} strokeWidth={2.4} color={activeColor} />
    </Pressable>
  );
}

function AssistantMessage({
  copied,
  message,
  onCopyMessage,
}: {
  readonly copied: boolean;
  readonly message: AssistantTranscriptItem;
  readonly onCopyMessage?: (messageId: string, text: string) => void;
}) {
  const actions = buildMessageActions(message);
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
          <View style={{ flex: 1 }} />
          <CopyMessageButton
            copied={copied}
            hidden={!actions.copyText}
            tone="assistant"
            onPress={() => actions.copyText ? onCopyMessage?.(message.id, actions.copyText) : undefined}
          />
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
  const [expandedToolIds, setExpandedToolIds] = useState<ReadonlySet<string>>(() => new Set());
  const ui = buildToolGroupUi(group.tools);
  const toggleTool = useCallback((toolId: string) => {
    setExpandedToolIds((current) => {
      const next = new Set(current);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }, []);

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
        style={{ alignItems: 'center', backgroundColor: ui.tint, borderRadius: 10, height: 34, justifyContent: 'center', width: 34 }}
      >
        <MobileIcon name="bolt" size={17} strokeWidth={2.35} color={ui.accent} />
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
          <View
            style={{
              alignItems: 'center',
              backgroundColor: ui.tint,
              borderRadius: 999,
              flexDirection: 'row',
              gap: 5,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            {ui.pulse ? (
              <View
                style={{
                  backgroundColor: ui.accent,
                  borderRadius: 999,
                  height: 6,
                  width: 6,
                }}
              />
            ) : null}
            <Text style={{ color: ui.accent, fontSize: 11, fontWeight: '800' }}>{ui.statusLabel}</Text>
          </View>
          <Text className="flex-1 text-[11px] font-medium text-dim" numberOfLines={1}>
            {ui.summary || group.summary}
          </Text>
          <Text className="text-[16px] font-bold text-dim">{open ? '-' : '+'}</Text>
        </Pressable>
        {open ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            {group.tools.map((tool) => (
              <ExpandableToolCard
                key={tool.id}
                tool={buildToolDetailUi(tool)}
                expanded={expandedToolIds.has(tool.id)}
                onToggle={() => toggleTool(tool.id)}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SubagentGroupMessage({ group }: { readonly group: SubagentGroupTranscriptItem }) {
  const [open, setOpen] = useState(group.status === 'running');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgent = selectSubagentDetailAgent(group, selectedAgentId);
  const accent = group.status === 'failed' ? '#ef4444' : group.status === 'running' ? '#8b5cf6' : '#16a34a';
  const tint = group.status === 'failed' ? '#fee2e2' : group.status === 'running' ? '#f5f3ff' : '#ecfdf5';

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
        <MobileIcon name="agent" size={17} strokeWidth={2.35} color={accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={{ alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 34 }}
        >
          <View
            style={{
              backgroundColor: accent,
              borderRadius: 999,
              height: 6,
              opacity: group.status === 'running' ? 1 : 0.7,
              width: 6,
            }}
          />
          <Text className="flex-1 text-[13px] font-bold text-text" numberOfLines={1}>
            {group.summary}
          </Text>
          <Text className="text-[16px] font-bold text-dim">{open ? '-' : '+'}</Text>
        </Pressable>
        {open ? (
          <View style={{ borderLeftColor: '#c7d2fe', borderLeftWidth: 1, gap: 6, marginTop: 6, paddingLeft: 10 }}>
            {group.agents.map((agent) => (
              <Pressable
                key={agent.id}
                accessibilityHint="Opens the subagent response and tool details"
                accessibilityLabel={`Open ${agent.label} details`}
                accessibilityRole="button"
                onPress={() => setSelectedAgentId(agent.id)}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? 'rgba(139, 92, 246, 0.08)' : 'transparent',
                  borderRadius: 10,
                  minHeight: 44,
                  minWidth: 0,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                })}
              >
                <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text className="text-[12px] font-semibold text-muted" numberOfLines={1}>
                      {agent.label} · {agent.toolCallCount} {agent.toolCallCount === 1 ? 'tool' : 'tools'}
                      {formatAgentTokens(agent.tokensUsed)}
                    </Text>
                    <Text style={{ color: agent.status === 'failed' ? '#ef4444' : accent, fontSize: 11, fontWeight: '800' }}>
                      {agent.status === 'done' ? 'Done' : agent.status === 'failed' ? 'Failed' : 'running'}
                    </Text>
                  </View>
                  <MobileIcon name="chevronRight" size={15} strokeWidth={2.4} color="#94a3b8" />
                </View>
                {agent.error ? (
                  <Text className="mt-1 text-[11px] leading-4 text-red" numberOfLines={2}>
                    {agent.error}
                  </Text>
                ) : null}
                {agent.finalPreview ? (
                  <Text className="mt-1 text-[11px] leading-4 text-dim" numberOfLines={2}>
                    {agent.finalPreview}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <SubagentDetailModal agent={selectedAgent} onClose={() => setSelectedAgentId(null)} />
    </View>
  );
}

function SubagentDetailModal({
  agent,
  onClose,
}: {
  readonly agent: SubagentTranscriptItem | null;
  readonly onClose: () => void;
}) {
  if (!agent) return null;
  return <SubagentDetailModalContent agent={agent} onClose={onClose} />;
}

function SubagentDetailModalContent({
  agent,
  onClose,
}: {
  readonly agent: SubagentTranscriptItem;
  readonly onClose: () => void;
}) {
  const [expandedToolIds, setExpandedToolIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggleTool = useCallback((toolId: string) => {
    setExpandedToolIds((current) => {
      const next = new Set(current);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }, []);
  const ui = buildSubagentDetailUi(agent);
  const tone = subagentDetailTone(ui.statusTone);

  return (
    <Modal
      animationType="fade"
      transparent
      visible
      onRequestClose={onClose}
    >
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: 'rgba(15, 23, 42, 0.48)',
          flex: 1,
          justifyContent: 'center',
          paddingHorizontal: 20,
          paddingVertical: 42,
        }}
      >
        <Pressable
          accessibilityLabel="Close subagent details"
          accessibilityRole="button"
          onPress={onClose}
          style={{
            bottom: 0,
            left: 0,
            position: 'absolute',
            right: 0,
            top: 0,
          }}
        />
        <View
          style={{
            alignSelf: 'center',
            backgroundColor: '#ffffff',
            borderColor: '#e3e5f0',
            borderRadius: 22,
            borderWidth: 1,
            maxHeight: '86%',
            overflow: 'hidden',
            shadowColor: '#0f172a',
            shadowOffset: { width: 0, height: 18 },
            shadowOpacity: 0.22,
            shadowRadius: 34,
            width: '100%',
          }}
        >
          <View
            style={{
              alignItems: 'center',
              borderBottomColor: '#eef0f7',
              borderBottomWidth: 1,
              flexDirection: 'row',
              gap: 12,
              paddingHorizontal: 18,
              paddingVertical: 16,
            }}
          >
            <View
              style={{
                alignItems: 'center',
                backgroundColor: '#f5f3ff',
                borderRadius: 12,
                height: 42,
                justifyContent: 'center',
                width: 42,
              }}
            >
              <MobileIcon name="agent" size={20} strokeWidth={2.5} color="#7c3aed" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text className="text-[17px] font-black text-text" numberOfLines={1}>{ui.title}</Text>
              <Text className="mt-0.5 text-[12px] font-semibold text-muted" numberOfLines={1}>{ui.subtitle}</Text>
            </View>
            <View
              style={{
                backgroundColor: tone.tint,
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 5,
              }}
            >
              <Text style={{ color: tone.accent, fontSize: 11, fontWeight: '900' }}>{ui.statusLabel}</Text>
            </View>
            <Pressable
              accessibilityLabel="Close subagent details"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => ({
                alignItems: 'center',
                backgroundColor: pressed ? '#eef0f7' : '#f8fafc',
                borderRadius: 999,
                height: 44,
                justifyContent: 'center',
                width: 44,
              })}
            >
              <MobileIcon name="x" size={19} strokeWidth={2.5} color="#64748b" />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{ gap: 16, paddingHorizontal: 18, paddingVertical: 16 }}
            showsVerticalScrollIndicator
          >
            <View>
              <Text className="text-[11px] font-black uppercase text-dim">{ui.meta}</Text>
            </View>
            <View>
              <Text className="text-[13px] font-black text-text">{ui.responseTitle}</Text>
              <View
                style={{
                  backgroundColor: '#f8fafc',
                  borderColor: '#e3e5f0',
                  borderRadius: 14,
                  borderWidth: 1,
                  marginTop: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <Text className="text-[13px] leading-5 text-text">{ui.responseText}</Text>
              </View>
            </View>
            <View>
              <Text className="text-[13px] font-black text-text">{ui.toolsTitle}</Text>
              {ui.emptyToolsText ? (
                <Text className="mt-2 text-[12px] leading-5 text-dim">{ui.emptyToolsText}</Text>
              ) : null}
              <View style={{ gap: 8, marginTop: 8 }}>
                {ui.tools.map((tool) => (
                  <ExpandableToolCard
                    key={tool.id}
                    tool={tool}
                    expanded={expandedToolIds.has(tool.id)}
                    onToggle={() => toggleTool(tool.id)}
                  />
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ExpandableToolCard({
  tool,
  expanded,
  onToggle,
}: {
  readonly tool: ToolDetailUi;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const toolTone = toolDetailTone(tool.statusTone);
  return (
    <Pressable
      accessibilityHint={expanded ? 'Collapses tool details' : 'Expands tool details'}
      accessibilityLabel={`${tool.name} ${tool.statusLabel}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => ({
        backgroundColor: pressed ? '#f8fafc' : '#ffffff',
        borderColor: expanded ? toolTone.border : '#e3e5f0',
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
      })}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 22 }}>
        <View style={{ backgroundColor: toolTone.accent, borderRadius: 999, height: 7, width: 7 }} />
        <Text className="flex-1 text-[12px] font-black text-text" numberOfLines={1}>{tool.name}</Text>
        <Text style={{ color: toolTone.accent, fontSize: 11, fontWeight: '900' }}>{tool.statusLabel}</Text>
        <MobileIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={15} strokeWidth={2.5} color="#94a3b8" />
      </View>
      {tool.summary ? (
        <Text className="mt-1 text-[11px] leading-4 text-muted" numberOfLines={expanded ? undefined : 2}>
          {tool.summary}
        </Text>
      ) : null}
      {expanded ? (
        <View
          style={{
            backgroundColor: '#f8fafc',
            borderColor: '#e3e5f0',
            borderRadius: 12,
            borderWidth: 1,
            marginTop: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}
        >
          <Text className="text-[10px] font-black uppercase text-dim">{tool.detailLabel}</Text>
          <Text className="mt-1 text-[11px] leading-4 text-text">
            {tool.detail ?? 'No details captured yet.'}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function subagentDetailTone(status: 'running' | 'done' | 'failed'): { readonly accent: string; readonly tint: string } {
  if (status === 'failed') return { accent: '#ef4444', tint: '#fee2e2' };
  if (status === 'done') return { accent: '#16a34a', tint: '#ecfdf5' };
  return { accent: '#8b5cf6', tint: '#f5f3ff' };
}

function toolDetailTone(status: 'running' | 'ok' | 'error'): { readonly accent: string; readonly border: string } {
  if (status === 'error') return { accent: '#ef4444', border: '#fecaca' };
  if (status === 'ok') return { accent: '#16a34a', border: '#bbf7d0' };
  return { accent: '#ec4899', border: '#f9a8d4' };
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

function formatAgentTokens(tokens: number | null): string {
  if (!tokens || tokens <= 0) return '';
  if (tokens >= 1000) return ` · ${(tokens / 1000).toFixed(1)}k tokens`;
  return ` · ${tokens} tokens`;
}
