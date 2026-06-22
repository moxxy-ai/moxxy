import type { MobileMarkdownBlock } from './mobileMarkdown';
import { buildMobileMarkdownBlocks } from './mobileMarkdown';
import type { TranscriptItem } from './chatTranscript';
import type { PromptAttachment } from './clientFrames';

export interface MobileMessageBlockRenderProps {
  readonly item: TranscriptItem;
  readonly copied: boolean;
  readonly onCopyMessage?: (messageId: string, text: string) => void;
}

export interface MobileChatListPerformanceProps {
  readonly initialNumToRender: number;
  readonly maxToRenderPerBatch: number;
  readonly updateCellsBatchingPeriod: number;
  readonly windowSize: number;
  readonly removeClippedSubviews: boolean;
  readonly scrollEventThrottle: number;
}

export function buildMobileChatListPerformanceProps(): MobileChatListPerformanceProps {
  return {
    initialNumToRender: 10,
    maxToRenderPerBatch: 6,
    updateCellsBatchingPeriod: 80,
    windowSize: 7,
    removeClippedSubviews: true,
    scrollEventThrottle: 16,
  };
}

export function shouldUpdateMobileMessageBlock(
  previous: MobileMessageBlockRenderProps,
  next: MobileMessageBlockRenderProps,
): boolean {
  return previous.copied !== next.copied
    || previous.onCopyMessage !== next.onCopyMessage
    || transcriptItemRenderSignature(previous.item) !== transcriptItemRenderSignature(next.item);
}

export interface MobileMarkdownBlockCacheOptions {
  readonly maxEntries?: number;
  readonly parse?: (text: string) => MobileMarkdownBlock[];
}

export interface MobileMarkdownBlockCache {
  readonly get: (text: string) => MobileMarkdownBlock[];
}

export function createMobileMarkdownBlockCache(
  options: MobileMarkdownBlockCacheOptions = {},
): MobileMarkdownBlockCache {
  const maxEntries = Math.max(1, options.maxEntries ?? 160);
  const parse = options.parse ?? buildMobileMarkdownBlocks;
  const cache = new Map<string, MobileMarkdownBlock[]>();

  return {
    get(text: string): MobileMarkdownBlock[] {
      const cached = cache.get(text);
      if (cached) {
        cache.delete(text);
        cache.set(text, cached);
        return cached;
      }

      const blocks = parse(text);
      cache.set(text, blocks);
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return blocks;
    },
  };
}

const mobileMarkdownBlockCache = createMobileMarkdownBlockCache();

export function getCachedMobileMarkdownBlocks(text: string): MobileMarkdownBlock[] {
  return mobileMarkdownBlockCache.get(text);
}

function transcriptItemRenderSignature(item: TranscriptItem): string {
  if (item.kind === 'user') {
    return [
      item.kind,
      item.id,
      item.text,
      item.attachments?.map(attachmentSignature).join('|') ?? '',
    ].join('\u001f');
  }

  if (item.kind === 'assistant') {
    return [item.kind, item.id, item.text, item.streaming ? 'streaming' : 'settled', item.stopReason ?? ''].join('\u001f');
  }

  if (item.kind === 'tool-group') {
    return [
      item.kind,
      item.id,
      item.summary,
      item.tools.map((tool) => [
        tool.id,
        tool.name,
        tool.status,
        tool.summary,
        tool.resultSummary ?? '',
        tool.error ?? '',
      ].join('\u001e')).join('\u001f'),
    ].join('\u001f');
  }

  if (item.kind === 'subagent-group') {
    return [
      item.kind,
      item.id,
      item.status,
      item.summary,
      item.agents.map((agent) => [
        agent.id,
        agent.label,
        agent.agentType,
        agent.status,
        agent.toolCallCount,
        agent.tokensUsed ?? '',
        agent.responseText,
        agent.finalPreview ?? '',
        agent.stopReason ?? '',
        agent.error ?? '',
        agent.toolCalls.map((tool) => [
          tool.id,
          tool.name,
          tool.status,
          tool.summary,
          tool.resultSummary ?? '',
          tool.error ?? '',
        ].join('\u001d')).join('\u001e'),
      ].join('\u001e')).join('\u001f'),
    ].join('\u001f');
  }

  if (item.kind === 'system-group') {
    return [
      item.kind,
      item.id,
      item.count,
      item.events.map((event) => `${event.id}\u001e${event.type}\u001e${event.text}`).join('\u001f'),
    ].join('\u001f');
  }

  return [item.kind, item.id, item.label, item.text].join('\u001f');
}

function attachmentSignature(attachment: PromptAttachment): string {
  return [
    attachment.kind,
    attachment.name ?? '',
    attachment.mediaType ?? '',
    attachment.content?.length ?? 0,
  ].join('\u001e');
}
