import { sx } from '../styles/tokens';
import {
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
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
import { useTheme } from '@/theme/ThemeProvider';
import type { Palette } from '@/styles/tokens';
import type { InlineTok } from '@moxxy/chat-model/markdown';
import type { ImageSourcePropType } from 'react-native';
import { BottomSheet, SheetGroup, SheetRow } from '@/ui/kit';
import { MobileIcon } from './MobileIcon';
import { ThinkingIndicator } from './ThinkingIndicator';

const CHAT_LIST_PERFORMANCE_PROPS = buildMobileChatListPerformanceProps();
const moxxyMascot = require('../../assets/moxxy-mascot-transparent.png') as ImageSourcePropType;

export interface ChatWelcome {
  readonly title: string;
  readonly subtitle: string;
}

interface ChatListProps {
  readonly items: ReadonlyArray<TranscriptItem>;
  readonly connectionBanner?: ReactNode;
  readonly sending?: boolean;
  readonly hasOlder?: boolean;
  readonly welcome?: ChatWelcome | null;
  readonly onLoadOlder?: () => void;
  readonly copiedMessageId?: string | null;
  readonly onCopyMessage?: (messageId: string, text: string) => void;
}

export function ChatList({
  items,
  connectionBanner,
  sending = false,
  hasOlder = false,
  welcome = null,
  onLoadOlder,
  copiedMessageId = null,
  onCopyMessage,
}: ChatListProps) {
  const { scheme } = useTheme();
  const [menu, setMenu] = useState<{ readonly id: string; readonly text: string } | null>(null);
  const onLongPressMessage = useCallback((id: string, text: string) => setMenu({ id, text }), []);
  const autoScroll = useChatListAutoScroll(items, sending);
  const trackScroll = autoScroll.handleScroll;
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    trackScroll(event);
    if (
      shouldLoadOlderFromScroll({
        contentOffsetY: event.nativeEvent.contentOffset.y,
        hasOlder,
      })
    ) {
      onLoadOlder?.();
    }
  }, [hasOlder, onLoadOlder, trackScroll]);
  const renderItem = useCallback<ListRenderItem<TranscriptItem>>(({ item }) => (
    <MemoMessageBlock
      item={item}
      copied={copiedMessageId === item.id}
      onCopyMessage={onCopyMessage}
      onLongPress={onLongPressMessage}
    />
  ), [copiedMessageId, onCopyMessage, onLongPressMessage]);
  const keyExtractor = useCallback((item: TranscriptItem) => item.id, []);
  const header = useCallback(() => (
    connectionBanner ? <View style={{ marginBottom: 16 }}>{connectionBanner}</View> : null
  ), [connectionBanner]);
  const empty = useCallback(() => {
    if (welcome && !connectionBanner) return <WelcomeView welcome={welcome} />;
    return <OfflineEmptyState hasConnectionBanner={Boolean(connectionBanner)} />;
  }, [connectionBanner, welcome]);
  const footer = useCallback(
    () => (shouldShowThinkingIndicator({ items, sending }) ? <ThinkingIndicator /> : null),
    [items, sending],
  );

  return (
    <View style={sx('flex-1')}>
      <FlatList
        // Remount the transcript on a theme flip so memoized rows re-resolve colors.
        key={scheme}
        ref={autoScroll.scrollRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        style={sx('flex-1')}
        contentContainerStyle={buildChatListContentStyle()}
        onContentSizeChange={autoScroll.handleContentSizeChange}
        onScroll={handleScroll}
        {...CHAT_LIST_PERFORMANCE_PROPS}
      />
      {autoScroll.showScrollToBottom ? <ScrollToBottomButton onPress={autoScroll.scrollToBottom} /> : null}
      <BottomSheet open={menu !== null} onClose={() => setMenu(null)} title="Message">
        <View style={{ paddingBottom: 8, paddingHorizontal: 16 }}>
          <SheetGroup>
            <SheetRow
              icon="copy"
              iconTone="brand"
              label="Copy text"
              onPress={() => {
                if (menu) onCopyMessage?.(menu.id, menu.text);
                setMenu(null);
              }}
            />
          </SheetGroup>
        </View>
      </BottomSheet>
    </View>
  );
}

function ScrollToBottomButton({ onPress }: { readonly onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel="Scroll to latest"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) =>
        sx('absolute items-center justify-center rounded-full', {
          alignSelf: 'center',
          backgroundColor: pressed ? colors.cardBg : colors.surface,
          borderColor: colors.cardBorder,
          borderWidth: 1,
          bottom: 12,
          height: 38,
          width: 38,
          ...shadowStyle(colors.shadow),
        })
      }
    >
      <MobileIcon name="chevronDown" size={20} strokeWidth={2.5} color={colors.text} />
    </Pressable>
  );
}

function shadowStyle(shadow: string) {
  return { elevation: 6, shadowColor: shadow, shadowOffset: { height: 6, width: 0 }, shadowOpacity: 0.4, shadowRadius: 12 };
}

function WelcomeView({ welcome }: { readonly welcome: ChatWelcome }) {
  const { colors } = useTheme();
  return (
    <View style={sx('flex-1 items-center justify-center', { paddingVertical: 16 })}>
      <View style={sx('items-center justify-center', { height: 136, width: 136 })}>
        <View style={sx('absolute rounded-full', { backgroundColor: colors.primary, height: 136, opacity: 0.09, width: 136 })} />
        <Image source={moxxyMascot} resizeMode="contain" accessibilityLabel="Moxxy" style={{ height: 124, width: 124 }} />
      </View>
      <Text style={sx('mt-3 text-[25px] font-black text-text text-center', { letterSpacing: -0.5 })}>{welcome.title}</Text>
      <Text style={sx('mt-2 text-[15px] font-medium text-muted text-center', { lineHeight: 21, maxWidth: 320 })}>
        {welcome.subtitle}
      </Text>
    </View>
  );
}

function OfflineEmptyState({ hasConnectionBanner }: { readonly hasConnectionBanner: boolean }) {
  const { colors } = useTheme();
  const copy = buildOfflineEmptyStateCopy(hasConnectionBanner);
  return (
    <View
      style={sx('self-stretch rounded-2xl border px-4 py-4', {
        backgroundColor: colors.cardBg,
        borderColor: colors.cardBorder,
        marginTop: hasConnectionBanner ? -2 : 20,
      })}
    >
      <Text style={sx('text-[17px] font-black text-text', { lineHeight: 22 })}>{copy.title}</Text>
      <Text style={sx('mt-1.5 text-[14px] text-muted', { lineHeight: 22 })}>{copy.body}</Text>
    </View>
  );
}

function MessageBlock({
  item,
  onLongPress,
}: MobileMessageBlockRenderProps) {
  const { colors } = useTheme();
  if (item.kind === 'user') {
    const actions = buildMessageActions(item);
    const hasText = item.text.trim().length > 0;
    const hasAttachments = Boolean(item.attachments?.length);
    return (
      <Pressable
        delayLongPress={300}
        onLongPress={() => onLongPress?.(item.id, actions.copyText ?? item.text)}
        style={{ alignItems: 'flex-start', alignSelf: 'flex-start', gap: 8, maxWidth: '88%' }}
        testID="mobile-user-message"
      >
        {hasAttachments ? <MessageAttachments attachments={item.attachments ?? []} /> : null}
        {hasText || !hasAttachments ? (
          <View
            testID="mobile-user-block"
            style={{
              backgroundColor: colors.primary,
              borderBottomLeftRadius: 6,
              borderBottomRightRadius: 18,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              maxWidth: '100%',
              paddingHorizontal: 16,
              paddingVertical: 11,
            }}
          >
            <Text style={sx('text-[15px] leading-6 text-white')}>{item.text}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  if (item.kind === 'assistant') {
    return <AssistantMessage message={item} onLongPress={onLongPress} />;
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
      style={{
        alignSelf: 'center',
        backgroundColor: colors.redSoft,
        borderColor: colors.redBorder,
        borderRadius: 12,
        borderWidth: 1,
        maxWidth: '92%',
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={sx('text-[12px] font-bold text-red')}>{item.label}</Text>
      <Text style={sx('mt-1 text-[13px] leading-5 text-muted')}>{item.text}</Text>
    </View>
  );
}

const MemoMessageBlock = memo(
  MessageBlock,
  (previous, next) => !shouldUpdateMobileMessageBlock(previous, next),
);

function MessageAttachments({ attachments }: { readonly attachments: ReadonlyArray<PromptAttachment> }) {
  return (
    <View style={{ alignItems: 'flex-start', gap: 7, maxWidth: '100%' }}>
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
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel={`Image attachment ${alt}`}
      testID="mobile-image-attachment-preview"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.cardBorder,
        borderRadius: 14,
        borderWidth: 1,
        overflow: 'hidden',
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
  const { colors } = useTheme();
  const summary = summarizeAttachment(attachment);
  return (
    <View
      style={{
        alignItems: 'center',
        alignSelf: 'flex-end',
        backgroundColor: colors.surface,
        borderColor: colors.pinkBorder,
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 6,
        maxWidth: '100%',
        paddingHorizontal: 9,
        paddingVertical: 5,
      }}
    >
      <Text style={{ color: colors.pinkText, fontSize: 10, fontWeight: '800', opacity: 0.78 }}>{summary.detail}</Text>
      <Text style={{ color: colors.pinkText, fontSize: 11, fontWeight: '800', maxWidth: 150 }} numberOfLines={1}>
        {summary.label}
      </Text>
    </View>
  );
}

function AssistantMessage({
  message,
  onLongPress,
}: {
  readonly message: AssistantTranscriptItem;
  readonly onLongPress?: (messageId: string, text: string) => void;
}) {
  const actions = buildMessageActions(message);
  return (
    <Pressable
      testID="mobile-assistant-block"
      delayLongPress={300}
      onLongPress={() => onLongPress?.(message.id, actions.copyText ?? message.text)}
      style={{ alignSelf: 'stretch', maxWidth: '100%' }}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
        <Text style={sx('text-[13px] font-bold text-text')}>{message.label}</Text>
        {message.streaming ? (
          <View style={sx('rounded-pill bg-primarySoft px-2 py-0.5')}>
            <Text style={sx('text-[11px] font-bold text-primary')}>typing...</Text>
          </View>
        ) : null}
      </View>
      {message.streaming ? (
        // While streaming, render the growing text as plain Text. Running the
        // cached markdown parser on every chunk is O(n^2) over the message and
        // pollutes the shared block cache (one entry per partial text, evicting
        // settled messages). Markdown is parsed once, below, when it settles.
        <Text style={sx('mt-1 text-[15px] leading-6 text-text')}>{message.text}</Text>
      ) : (
        <MobileMarkdownText text={message.text} style={{ marginTop: 4 }} />
      )}
      {!message.streaming && message.stopReason && message.stopReason !== 'end_turn' ? (
        <Text style={sx('mt-1 text-[10px] font-bold uppercase text-dim')}>stop: {message.stopReason.replace(/_/g, ' ')}</Text>
      ) : null}
    </Pressable>
  );
}

function toolGroupTone(label: 'failed' | 'running' | 'ok', colors: Palette): { accent: string; tint: string } {
  if (label === 'failed') return { accent: colors.red, tint: colors.redTint };
  if (label === 'running') return { accent: colors.primary, tint: colors.primarySoft };
  return { accent: colors.greenStrong, tint: colors.greenSoft };
}

function ToolGroupMessage({ group }: { readonly group: ToolGroupTranscriptItem }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [expandedToolIds, setExpandedToolIds] = useState<ReadonlySet<string>>(() => new Set());
  const ui = buildToolGroupUi(group.tools);
  const tone = toolGroupTone(ui.statusLabel, colors);
  const toggleTool = useCallback((toolId: string) => {
    setExpandedToolIds((current) => {
      const next = new Set(current);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }, []);

  return (
    <View style={{ alignSelf: 'stretch', flexDirection: 'row', gap: 12, maxWidth: '96%' }}>
      <View style={{ alignItems: 'center', backgroundColor: tone.tint, borderRadius: 10, height: 34, justifyContent: 'center', width: 34 }}>
        <MobileIcon name="bolt" size={17} strokeWidth={2.35} color={tone.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={{ alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 34 }}
        >
          <Text style={sx('text-[13px] font-bold text-text')}>{group.title}</Text>
          <Text style={sx('text-[11px] font-bold text-dim')}>{group.tools.length}</Text>
          <View
            style={{
              alignItems: 'center',
              backgroundColor: tone.tint,
              borderRadius: 999,
              flexDirection: 'row',
              gap: 5,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            {ui.pulse ? <View style={{ backgroundColor: tone.accent, borderRadius: 999, height: 6, width: 6 }} /> : null}
            <Text style={{ color: tone.accent, fontSize: 11, fontWeight: '800' }}>{ui.statusLabel}</Text>
          </View>
          <Text style={sx('flex-1 text-[11px] font-medium text-dim')} numberOfLines={1}>
            {ui.summary || group.summary}
          </Text>
          <Text style={sx('text-[16px] font-bold text-dim')}>{open ? '-' : '+'}</Text>
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

function subagentTone(status: 'running' | 'done' | 'failed', colors: Palette): { accent: string; tint: string } {
  if (status === 'failed') return { accent: colors.red, tint: colors.redTint };
  if (status === 'done') return { accent: colors.greenStrong, tint: colors.greenSoft };
  return { accent: colors.purple, tint: colors.purpleSoft };
}

function SubagentGroupMessage({ group }: { readonly group: SubagentGroupTranscriptItem }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(group.status === 'running');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgent = selectSubagentDetailAgent(group, selectedAgentId);
  const { accent, tint } = subagentTone(group.status, colors);

  return (
    <View style={{ alignSelf: 'stretch', flexDirection: 'row', gap: 12, maxWidth: '96%' }}>
      <View style={{ alignItems: 'center', backgroundColor: tint, borderRadius: 10, height: 34, justifyContent: 'center', width: 34 }}>
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
          <Text style={sx('flex-1 text-[13px] font-bold text-text')} numberOfLines={1}>
            {group.summary}
          </Text>
          <Text style={sx('text-[16px] font-bold text-dim')}>{open ? '-' : '+'}</Text>
        </Pressable>
        {open ? (
          <View style={{ borderLeftColor: colors.purpleBorder, borderLeftWidth: 1, gap: 6, marginTop: 6, paddingLeft: 10 }}>
            {group.agents.map((agent) => (
              <Pressable
                key={agent.id}
                accessibilityHint="Opens the subagent response and tool details"
                accessibilityLabel={`Open ${agent.label} details`}
                accessibilityRole="button"
                onPress={() => setSelectedAgentId(agent.id)}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? colors.purpleSoft : 'transparent',
                  borderRadius: 10,
                  minHeight: 44,
                  minWidth: 0,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                })}
              >
                <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={sx('text-[12px] font-semibold text-muted')} numberOfLines={1}>
                      {agent.label} · {agent.toolCallCount} {agent.toolCallCount === 1 ? 'tool' : 'tools'}
                      {formatAgentTokens(agent.tokensUsed)}
                    </Text>
                    <Text style={{ color: agent.status === 'failed' ? colors.red : accent, fontSize: 11, fontWeight: '800' }}>
                      {agent.status === 'done' ? 'Done' : agent.status === 'failed' ? 'Failed' : 'running'}
                    </Text>
                  </View>
                  <MobileIcon name="chevronRight" size={15} strokeWidth={2.4} color={colors.textDim} />
                </View>
                {agent.error ? (
                  <Text style={sx('mt-1 text-[11px] leading-4 text-red')} numberOfLines={2}>
                    {agent.error}
                  </Text>
                ) : null}
                {agent.finalPreview ? (
                  <Text style={sx('mt-1 text-[11px] leading-4 text-dim')} numberOfLines={2}>
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
  const { colors } = useTheme();
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
  const tone = subagentDetailTone(ui.statusTone, colors);

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View
        accessibilityViewIsModal
        style={{ backgroundColor: colors.overlay, flex: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 42 }}
      >
        <Pressable
          accessibilityLabel="Close subagent details"
          accessibilityRole="button"
          onPress={onClose}
          style={{ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }}
        />
        <View
          style={{
            alignSelf: 'center',
            backgroundColor: colors.cardBg,
            borderColor: colors.cardBorder,
            borderRadius: 22,
            borderWidth: 1,
            maxHeight: '86%',
            overflow: 'hidden',
            width: '100%',
          }}
        >
          <View
            style={{
              alignItems: 'center',
              borderBottomColor: colors.cardBorder,
              borderBottomWidth: 1,
              flexDirection: 'row',
              gap: 12,
              paddingHorizontal: 18,
              paddingVertical: 16,
            }}
          >
            <View style={{ alignItems: 'center', backgroundColor: colors.purpleSoft, borderRadius: 12, height: 42, justifyContent: 'center', width: 42 }}>
              <MobileIcon name="agent" size={20} strokeWidth={2.5} color={colors.purpleStrong} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={sx('text-[17px] font-black text-text')} numberOfLines={1}>{ui.title}</Text>
              <Text style={sx('mt-0.5 text-[12px] font-semibold text-muted')} numberOfLines={1}>{ui.subtitle}</Text>
            </View>
            <View style={{ backgroundColor: tone.tint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: tone.accent, fontSize: 11, fontWeight: '900' }}>{ui.statusLabel}</Text>
            </View>
            <Pressable
              accessibilityLabel="Close subagent details"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => ({
                alignItems: 'center',
                backgroundColor: pressed ? colors.inputSoft : colors.surface,
                borderRadius: 999,
                height: 44,
                justifyContent: 'center',
                width: 44,
              })}
            >
              <MobileIcon name="x" size={19} strokeWidth={2.5} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 16, paddingHorizontal: 18, paddingVertical: 16 }} showsVerticalScrollIndicator>
            <View>
              <Text style={sx('text-[11px] font-black uppercase text-dim')}>{ui.meta}</Text>
            </View>
            <View>
              <Text style={sx('text-[13px] font-black text-text')}>{ui.responseTitle}</Text>
              <View style={{ backgroundColor: colors.inputSoft, borderColor: colors.cardBorder, borderRadius: 14, borderWidth: 1, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
                <MobileMarkdownText compact text={ui.responseText} />
              </View>
            </View>
            <View>
              <Text style={sx('text-[13px] font-black text-text')}>{ui.toolsTitle}</Text>
              {ui.emptyToolsText ? <Text style={sx('mt-2 text-[12px] leading-5 text-dim')}>{ui.emptyToolsText}</Text> : null}
              <View style={{ gap: 8, marginTop: 8 }}>
                {ui.tools.map((tool) => (
                  <ExpandableToolCard key={tool.id} tool={tool} expanded={expandedToolIds.has(tool.id)} onToggle={() => toggleTool(tool.id)} />
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
  const { colors } = useTheme();
  const toolTone = toolDetailTone(tool.statusTone, colors);
  return (
    <Pressable
      accessibilityHint={expanded ? 'Collapses tool details' : 'Expands tool details'}
      accessibilityLabel={`${tool.name} ${tool.statusLabel}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.inputSoft : colors.cardBg,
        borderColor: expanded ? toolTone.border : colors.cardBorder,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
      })}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 22 }}>
        <View style={{ backgroundColor: toolTone.accent, borderRadius: 999, height: 7, width: 7 }} />
        <Text style={sx('flex-1 text-[12px] font-black text-text')} numberOfLines={1}>{tool.name}</Text>
        <Text style={{ color: toolTone.accent, fontSize: 11, fontWeight: '900' }}>{tool.statusLabel}</Text>
        <MobileIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={15} strokeWidth={2.5} color={colors.textDim} />
      </View>
      {tool.summary ? (
        <Text style={sx('mt-1 text-[11px] leading-4 text-muted')} numberOfLines={expanded ? undefined : 2}>
          {tool.summary}
        </Text>
      ) : null}
      {expanded ? (
        <View style={{ backgroundColor: colors.inputSoft, borderColor: colors.cardBorder, borderRadius: 12, borderWidth: 1, marginTop: 8, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Text style={sx('text-[10px] font-black uppercase text-dim')}>{tool.detailLabel}</Text>
          <Text style={sx('mt-1 text-[11px] leading-4 text-text')}>{tool.detail ?? 'No details captured yet.'}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function subagentDetailTone(status: 'running' | 'done' | 'failed', colors: Palette): { readonly accent: string; readonly tint: string } {
  if (status === 'failed') return { accent: colors.red, tint: colors.redTint };
  if (status === 'done') return { accent: colors.greenStrong, tint: colors.greenSoft };
  return { accent: colors.purple, tint: colors.purpleSoft };
}

function toolDetailTone(status: 'running' | 'ok' | 'error', colors: Palette): { readonly accent: string; readonly border: string } {
  if (status === 'error') return { accent: colors.red, border: colors.redBorder };
  if (status === 'ok') return { accent: colors.greenStrong, border: colors.greenBorder };
  return { accent: colors.primary, border: colors.pinkBorder };
}

function SystemGroupMessage({ group }: { readonly group: SystemGroupTranscriptItem }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ alignSelf: 'stretch', flexDirection: 'row', gap: 12, maxWidth: '96%' }}>
      <View style={sx('h-[34px] w-[34px] items-center justify-center rounded-block', { backgroundColor: colors.inputSoft })}>
        <MobileIcon name="more" size={17} strokeWidth={2.35} color={colors.textDim} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={{ alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 34 }}
        >
          <Text style={sx('text-[12px] font-bold text-muted')}>{group.title}</Text>
          <Text style={sx('text-[11px] font-bold text-dim')}>{group.count} events</Text>
          <Text style={sx('flex-1 text-[11px] text-dim')} numberOfLines={1}>collapsed</Text>
          <Text style={sx('text-[16px] font-bold text-dim')}>{open ? '-' : '+'}</Text>
        </Pressable>
        {open ? (
          <View style={sx('mt-2 rounded-block border border-cardBorder bg-cardBg px-3 py-2')}>
            {group.events.map((event) => (
              <View key={event.id} style={sx('py-1')}>
                <Text style={sx('text-[11px] font-bold text-muted')}>{event.type}</Text>
                <Text style={sx('text-[11px] leading-4 text-dim')}>{event.text}</Text>
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
  const { colors } = useTheme();
  if (block.kind === 'heading') {
    const size = block.level <= 2 ? (compact ? 14 : 17) : compact ? 13 : 15;
    return (
      <Text style={{ color: colors.text, fontSize: size, fontWeight: '900', lineHeight: compact ? 20 : 25, marginTop: index === 0 ? 0 : 2 }}>
        {block.text}
      </Text>
    );
  }

  if (block.kind === 'paragraph') {
    return <MobileInlineText style={{ color: colors.text, fontSize: compact ? 13 : 15, lineHeight: compact ? 20 : 24 }} tokens={block.inline} />;
  }

  if (block.kind === 'list') {
    return (
      <View style={{ gap: compact ? 4 : 6 }}>
        {block.items.map((item, itemIndex) => (
          <View key={`item:${itemIndex}`} style={{ flexDirection: 'row', gap: 7 }}>
            <Text style={{ color: colors.textMuted, fontSize: compact ? 13 : 15, fontWeight: '800', lineHeight: compact ? 20 : 24, minWidth: block.ordered ? 22 : 12 }}>
              {block.ordered ? `${itemIndex + 1}.` : '•'}
            </Text>
            <MobileInlineText style={{ color: colors.text, flex: 1, fontSize: compact ? 13 : 15, lineHeight: compact ? 20 : 24 }} tokens={item} />
          </View>
        ))}
      </View>
    );
  }

  if (block.kind === 'code') {
    return (
      <View style={{ backgroundColor: colors.codeBg, borderColor: colors.cardBorder, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 }}>
        <Text selectable style={{ color: colors.codeText, fontFamily: 'Menlo', fontSize: compact ? 11 : 12, lineHeight: compact ? 16 : 18 }}>
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
  const { colors } = useTheme();
  const rows = [block.header, ...block.rows];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ borderColor: colors.cardBorder, borderRadius: 10, borderWidth: 1, minWidth: 260, overflow: 'hidden' }}>
        {rows.map((row, rowIndex) => (
          <View
            key={`row:${rowIndex}`}
            style={{ backgroundColor: rowIndex === 0 ? colors.inputSoft : colors.cardBg, borderTopColor: colors.cardBorder, borderTopWidth: rowIndex === 0 ? 0 : 1, flexDirection: 'row' }}
          >
            {row.map((cell, cellIndex) => (
              <View key={`cell:${rowIndex}:${cellIndex}`} style={{ borderLeftColor: colors.cardBorder, borderLeftWidth: cellIndex === 0 ? 0 : 1, paddingHorizontal: 8, paddingVertical: 7, width: 132 }}>
                <MobileInlineText style={{ color: colors.text, fontSize: compact ? 11 : 12, fontWeight: rowIndex === 0 ? '800' : '500', lineHeight: compact ? 16 : 18 }} tokens={cell} />
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// Markdown links come from assistant/relay-sourced text and the user only sees
// the label, not the target. Only open standard web/mail schemes so an injected
// or compromised reply can't trigger out-of-app actions (tel:/sms:/custom app
// deep links) via a link the user can't inspect.
const ALLOWED_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function openMarkdownLink(rawUrl: string): void {
  let scheme: string;
  try {
    scheme = new URL(rawUrl).protocol.toLowerCase();
  } catch {
    return; // unparseable / relative — ignore
  }
  if (!ALLOWED_LINK_SCHEMES.has(scheme)) return;
  void Linking.openURL(rawUrl);
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
  const { colors } = useTheme();
  if (token.kind === 'text') return <Text>{token.value}</Text>;
  if (token.kind === 'bold') return <Text style={{ fontWeight: '900' }}>{token.value}</Text>;
  if (token.kind === 'italic') return <Text style={{ fontStyle: 'italic' }}>{token.value}</Text>;
  if (token.kind === 'code') {
    return (
      <Text style={{ backgroundColor: colors.codeInline, borderRadius: 5, color: colors.codeText, fontFamily: 'Menlo', fontSize: 13, paddingHorizontal: 3 }}>
        {token.value}
      </Text>
    );
  }
  return (
    <Text accessibilityRole="link" onPress={() => openMarkdownLink(token.url)} style={{ color: colors.pinkText, fontWeight: '800', textDecorationLine: 'underline' }}>
      {token.label}
    </Text>
  );
}
