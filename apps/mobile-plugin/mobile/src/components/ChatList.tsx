import {
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ListRenderItem,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { memo, useCallback, useState, type ReactNode } from 'react';
import { buildChatAttachmentPreview, summarizeAttachment } from '@/attachments';
import { buildChatListContentStyle, buildOfflineEmptyStateCopy } from '@/chatListLayout';
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
import {
  buildMobileChatListPerformanceProps,
  getCachedMobileMarkdownBlocks,
  shouldUpdateMobileMessageBlock,
  type MobileMessageBlockRenderProps,
} from '@/chatListPerformance';
import { buildMessageActions } from '@/messageActions';
import type { MobileMarkdownBlock } from '@/mobileMarkdown';
import { buildSubagentDetailUi, selectSubagentDetailAgent } from '@/subagentDetailUi';
import { buildToolDetailUi, buildToolGroupUi, type ToolDetailUi } from '@/toolGroupUi';
import type { InlineTok } from '@moxxy/chat-model/markdown';
import { MobileIcon } from './MobileIcon';
import { ThinkingIndicator } from './ThinkingIndicator';

const CHAT_LIST_PERFORMANCE_PROPS = buildMobileChatListPerformanceProps();

interface ChatListProps {
  readonly items: ReadonlyArray<TranscriptItem>;
  readonly connectionBanner?: ReactNode;
  readonly sending?: boolean;
  readonly hasOlder?: boolean;
  readonly onLoadOlder?: () => void;
  readonly copiedMessageId?: string | null;
  readonly onCopyMessage?: (messageId: string, text: string) => void;
}

export function ChatList({
  items,
  connectionBanner,
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
  const header = useCallback(() => (
    connectionBanner ? <View style={{ marginBottom: 16 }}>{connectionBanner}</View> : null
  ), [connectionBanner]);
  const empty = useCallback(() => {
    const copy = buildOfflineEmptyStateCopy(Boolean(connectionBanner));
    return (
      <View style={[styles.emptyState, connectionBanner ? styles.emptyStateCompact : styles.emptyStateRoomy]}>
        <Text style={styles.emptyTitle}>{copy.title}</Text>
        <Text style={styles.emptyBody}>{copy.body}</Text>
      </View>
    );
  }, [connectionBanner]);
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
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      className="flex-1"
      contentContainerStyle={buildChatListContentStyle()}
      onContentSizeChange={autoScroll.handleContentSizeChange}
      onScroll={handleScroll}
      {...CHAT_LIST_PERFORMANCE_PROPS}
    />
  );
}

const styles = StyleSheet.create({
  emptyBody: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 6,
  },
  emptyState: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderColor: '#e3e5f0',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  emptyStateCompact: {
    marginTop: -2,
  },
  emptyStateRoomy: {
    marginTop: 20,
  },
  emptyTitle: {
    color: '#0f172a',
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
  },
});

function MessageBlock({
  item,
  copied,
  onCopyMessage,
}: MobileMessageBlockRenderProps) {
  if (item.kind === 'user') {
    const actions = buildMessageActions(item);
    const hasText = item.text.trim().length > 0;
    const hasAttachments = Boolean(item.attachments?.length);
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
          style={{ alignItems: 'flex-end', flexShrink: 1, gap: 8, maxWidth: '100%' }}
        >
          {hasAttachments ? <MessageAttachments attachments={item.attachments ?? []} /> : null}
          {hasText || !hasAttachments ? (
            <View
              testID="mobile-user-block"
              style={{
                backgroundColor: '#ec4899',
                borderBottomLeftRadius: 16,
                borderBottomRightRadius: 4,
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
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

const MemoMessageBlock = memo(
  MessageBlock,
  (previous, next) => !shouldUpdateMobileMessageBlock(previous, next),
);

function MessageAttachments({ attachments }: { readonly attachments: ReadonlyArray<PromptAttachment> }) {
  return (
    <View style={{ alignItems: 'flex-end', gap: 7, maxWidth: '100%' }}>
      {attachments.map((attachment, index) => {
        const preview = buildChatAttachmentPreview(attachment);
        const key = `${attachment.kind}:${attachment.name ?? index}:${index}`;
        if (preview) {
          return <ImageAttachmentPreview key={key} alt={preview.alt} uri={preview.uri} />;
        }
        return <MessageAttachmentChip key={key} attachment={attachment} />;
      })}
    </View>
  );
}

function ImageAttachmentPreview({ alt, uri }: { readonly alt: string; readonly uri: string }) {
  return (
    <View
      accessibilityLabel={`Image attachment ${alt}`}
      testID="mobile-image-attachment-preview"
      style={{
        backgroundColor: '#ffffff',
        borderColor: '#e3e5f0',
        borderRadius: 14,
        borderWidth: 1,
        overflow: 'hidden',
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
      }}
    >
      <Image
        accessibilityIgnoresInvertColors
        resizeMode="cover"
        source={{ uri }}
        style={{ height: 176, width: 176 }}
      />
    </View>
  );
}

function MessageAttachmentChip({ attachment }: { readonly attachment: PromptAttachment }) {
  const summary = summarizeAttachment(attachment);
  return (
    <View
      style={{
        alignItems: 'center',
        alignSelf: 'flex-end',
        backgroundColor: '#ffffff',
        borderColor: '#f9a8d4',
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 6,
        maxWidth: '100%',
        paddingHorizontal: 9,
        paddingVertical: 5,
      }}
    >
      <Text style={{ color: '#be185d', fontSize: 10, fontWeight: '800', opacity: 0.78 }}>{summary.detail}</Text>
      <Text style={{ color: '#be185d', fontSize: 11, fontWeight: '800', maxWidth: 150 }} numberOfLines={1}>
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
        <MobileMarkdownText text={message.text} style={{ marginTop: 4 }} />
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
                <MobileMarkdownText compact text={ui.responseText} />
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

function MobileMarkdownText({
  compact = false,
  style,
  text,
}: {
  readonly compact?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly text: string;
}) {
  const blocks = getCachedMobileMarkdownBlocks(text);
  if (blocks.length === 0) return null;
  return (
    <View style={[{ gap: compact ? 6 : 10 }, style]}>
      {blocks.map((block, index) => (
        <MobileMarkdownBlockView block={block} compact={compact} index={index} key={`${block.kind}:${index}`} />
      ))}
    </View>
  );
}

function MobileMarkdownBlockView({
  block,
  compact,
  index,
}: {
  readonly block: MobileMarkdownBlock;
  readonly compact: boolean;
  readonly index: number;
}) {
  if (block.kind === 'heading') {
    const size = block.level <= 2 ? (compact ? 14 : 17) : compact ? 13 : 15;
    return (
      <Text
        style={{
          color: '#111827',
          fontSize: size,
          fontWeight: '900',
          lineHeight: compact ? 20 : 25,
          marginTop: index === 0 ? 0 : 2,
        }}
      >
        {block.text}
      </Text>
    );
  }

  if (block.kind === 'paragraph') {
    return (
      <MobileInlineText
        style={{
          color: '#111827',
          fontSize: compact ? 13 : 15,
          lineHeight: compact ? 20 : 24,
        }}
        tokens={block.inline}
      />
    );
  }

  if (block.kind === 'list') {
    return (
      <View style={{ gap: compact ? 4 : 6 }}>
        {block.items.map((item, itemIndex) => (
          <View key={`item:${itemIndex}`} style={{ flexDirection: 'row', gap: 7 }}>
            <Text
              style={{
                color: '#64748b',
                fontSize: compact ? 13 : 15,
                fontWeight: '800',
                lineHeight: compact ? 20 : 24,
                minWidth: block.ordered ? 22 : 12,
              }}
            >
              {block.ordered ? `${itemIndex + 1}.` : '•'}
            </Text>
            <MobileInlineText
              style={{
                color: '#111827',
                flex: 1,
                fontSize: compact ? 13 : 15,
                lineHeight: compact ? 20 : 24,
              }}
              tokens={item}
            />
          </View>
        ))}
      </View>
    );
  }

  if (block.kind === 'code') {
    return (
      <View
        style={{
          backgroundColor: '#f8fafc',
          borderColor: '#e3e5f0',
          borderRadius: 12,
          borderWidth: 1,
          paddingHorizontal: 10,
          paddingVertical: 8,
        }}
      >
        <Text
          selectable
          style={{
            color: '#334155',
            fontFamily: 'Menlo',
            fontSize: compact ? 11 : 12,
            lineHeight: compact ? 16 : 18,
          }}
        >
          {block.body}
        </Text>
      </View>
    );
  }

  return <MobileMarkdownTable block={block} compact={compact} />;
}

function MobileMarkdownTable({
  block,
  compact,
}: {
  readonly block: Extract<MobileMarkdownBlock, { kind: 'table' }>;
  readonly compact: boolean;
}) {
  const rows = [block.header, ...block.rows];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View
        style={{
          borderColor: '#e3e5f0',
          borderRadius: 10,
          borderWidth: 1,
          minWidth: 260,
          overflow: 'hidden',
        }}
      >
        {rows.map((row, rowIndex) => (
          <View
            key={`row:${rowIndex}`}
            style={{
              backgroundColor: rowIndex === 0 ? '#f8fafc' : '#ffffff',
              borderTopColor: '#e3e5f0',
              borderTopWidth: rowIndex === 0 ? 0 : 1,
              flexDirection: 'row',
            }}
          >
            {row.map((cell, cellIndex) => (
              <View
                key={`cell:${rowIndex}:${cellIndex}`}
                style={{
                  borderLeftColor: '#e3e5f0',
                  borderLeftWidth: cellIndex === 0 ? 0 : 1,
                  paddingHorizontal: 8,
                  paddingVertical: 7,
                  width: 132,
                }}
              >
                <MobileInlineText
                  style={{
                    color: '#111827',
                    fontSize: compact ? 11 : 12,
                    fontWeight: rowIndex === 0 ? '800' : '500',
                    lineHeight: compact ? 16 : 18,
                  }}
                  tokens={cell}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function MobileInlineText({
  style,
  tokens,
}: {
  readonly style?: StyleProp<TextStyle>;
  readonly tokens: ReadonlyArray<InlineTok>;
}) {
  return (
    <Text style={style}>
      {tokens.map((token, index) => (
        <MobileInlineToken key={`${token.kind}:${index}`} token={token} />
      ))}
    </Text>
  );
}

function MobileInlineToken({ token }: { readonly token: InlineTok }) {
  if (token.kind === 'text') return <Text>{token.value}</Text>;
  if (token.kind === 'bold') return <Text style={{ fontWeight: '900' }}>{token.value}</Text>;
  if (token.kind === 'italic') return <Text style={{ fontStyle: 'italic' }}>{token.value}</Text>;
  if (token.kind === 'code') {
    return (
      <Text
        style={{
          backgroundColor: '#eef2ff',
          borderRadius: 5,
          color: '#334155',
          fontFamily: 'Menlo',
          fontSize: 13,
          paddingHorizontal: 3,
        }}
      >
        {token.value}
      </Text>
    );
  }
  return (
    <Text
      accessibilityRole="link"
      onPress={() => {
        void Linking.openURL(token.url);
      }}
      style={{ color: '#db2777', fontWeight: '800', textDecorationLine: 'underline' }}
    >
      {token.label}
    </Text>
  );
}
