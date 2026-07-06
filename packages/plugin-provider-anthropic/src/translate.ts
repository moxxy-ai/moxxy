import type { ContentBlock, ProviderMessage, ToolDef } from '@moxxy/sdk';
import { assertDefined, zodToJsonSchema } from '@moxxy/sdk';

type CacheControl = { type: 'ephemeral' };

/** Media types Anthropic's Messages API accepts for `image`/`document` blocks. */
const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
const DOCUMENT_MEDIA_TYPES: ReadonlySet<string> = new Set(['application/pdf']);

export interface AnthropicMessageInput {
  role: 'user' | 'assistant';
  content: Array<AnthropicContentBlock>;
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'tool_use'; id: string; name: string; input: unknown; cache_control?: CacheControl }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
      cache_control?: CacheControl;
    }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
      cache_control?: CacheControl;
    }
  | {
      type: 'document';
      source: { type: 'base64'; media_type: string; data: string };
      title?: string;
      cache_control?: CacheControl;
    }
  // Reasoning round-trip: a signed `thinking` block (replayed verbatim on the
  // same model so Anthropic accepts an interleaved-thinking tool-use turn) or a
  // `redacted_thinking` block carrying only the opaque encrypted blob.
  | { type: 'thinking'; thinking: string; signature: string; cache_control?: CacheControl }
  | { type: 'redacted_thinking'; data: string; cache_control?: CacheControl };

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: unknown;
  cache_control?: CacheControl;
}

export interface ToAnthropicMessagesOptions {
  /**
   * Indices (into the input `messages` array) after which a prompt-cache
   * breakpoint should be placed. The marker lands on the last Anthropic
   * content block produced for that source message.
   */
  readonly cacheMessageIndices?: ReadonlySet<number>;
}

function markCache(block: AnthropicContentBlock | undefined): void {
  if (block) block.cache_control = { type: 'ephemeral' };
}

export function toAnthropicMessages(
  messages: ReadonlyArray<ProviderMessage>,
  opts: ToAnthropicMessagesOptions = {},
): {
  system: string | undefined;
  messages: AnthropicMessageInput[];
} {
  const cacheIdx = opts.cacheMessageIndices;
  let system: string | undefined;
  const out: AnthropicMessageInput[] = [];
  let pendingUserBlocks: AnthropicContentBlock[] | null = null;
  const flushUser = (): void => {
    if (pendingUserBlocks) {
      out.push({ role: 'user', content: pendingUserBlocks });
      pendingUserBlocks = null;
    }
  };

  messages.forEach((msg, i) => {
    const wantCache = cacheIdx?.has(i) ?? false;

    if (msg.role === 'system') {
      // Join ALL text blocks of a system message (not just the first) so a
      // multi-block system prompt isn't silently truncated; mirrors the
      // cross-message join below.
      const text = msg.content
        .filter((c): c is Extract<ContentBlock, { type: 'text' }> => c.type === 'text')
        .map((c) => c.text)
        .join('\n\n');
      if (text) {
        system = system ? `${system}\n\n${text}` : text;
      }
      return;
    }

    if (msg.role === 'user') {
      flushUser();
      const content = mapBlocks(msg.content);
      if (wantCache) markCache(content[content.length - 1]);
      out.push({ role: 'user', content });
      return;
    }

    if (msg.role === 'assistant') {
      flushUser();
      const content = mapBlocks(msg.content);
      if (wantCache) markCache(content[content.length - 1]);
      out.push({ role: 'assistant', content });
      return;
    }

    if (msg.role === 'tool_result') {
      // Tool results are merged into a user message with tool_result content blocks
      pendingUserBlocks ??= [];
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          pendingUserBlocks.push({
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
            is_error: block.isError,
          });
        }
      }
      // Breakpoint after a tool-result source message lands on the last block
      // appended for it. Caching up to a mid-message block is valid (it just
      // defines the prefix boundary), so merging doesn't break this.
      if (wantCache) markCache(pendingUserBlocks[pendingUserBlocks.length - 1]);
    }
  });
  flushUser();
  return { system, messages: out };
}

/** Translate a message's blocks, dropping any that translate to nothing. */
function mapBlocks(blocks: ReadonlyArray<ContentBlock>): AnthropicContentBlock[] {
  const out: AnthropicContentBlock[] = [];
  for (const b of blocks) {
    const t = toAnthropicBlock(b);
    if (t) out.push(t);
  }
  return out;
}

function toAnthropicBlock(block: ContentBlock): AnthropicContentBlock | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
    case 'image':
      // Reject unsupported media types locally (degrade to a placeholder, as
      // audio does) rather than uploading bytes that 400 deep in the SDK. A
      // resumed session or hostile channel can supply an out-of-allow-list
      // type; the documented Anthropic image set is png/jpeg/gif/webp.
      if (!IMAGE_MEDIA_TYPES.has(block.mediaType)) {
        return {
          type: 'text',
          text: `[image attachment dropped: ${block.mediaType} not a supported image type]`,
        };
      }
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.mediaType, data: block.data },
      };
    case 'document':
      // Native document support (PDF). Claude reads text + figures/layout.
      // Documented Anthropic document set is application/pdf only.
      if (!DOCUMENT_MEDIA_TYPES.has(block.mediaType)) {
        return {
          type: 'text',
          text: `[document attachment dropped: ${block.mediaType} not a supported document type]`,
        };
      }
      return {
        type: 'document',
        source: { type: 'base64', media_type: block.mediaType, data: block.data },
        ...(block.name ? { title: block.name } : {}),
      };
    case 'audio':
      // Anthropic's Messages API does not accept native audio yet. Channels
      // are supposed to transcribe up-front when the active model lacks
      // `supportsAudio`; if an audio block reaches the translator anyway
      // (e.g. a resumed session originally captured on a different
      // provider), degrade to a text placeholder rather than throwing.
      return {
        type: 'text',
        text: `[audio attachment dropped: ${block.mediaType} not supported by this model]`,
      };
    case 'reasoning':
      // Replayed verbatim so Anthropic accepts an interleaved-thinking tool-use
      // continuation. `redacted` → the opaque encrypted blob; otherwise the
      // signed thinking block. Drop an unsigned/unredacted reasoning block
      // rather than degrading it to a stray assistant text block: Anthropic
      // rejects an unsigned thinking block, and emitting it as text could leak
      // raw reasoning into assistant output or 400 a tool-use turn. The
      // translator stays self-consistent without depending on the upstream
      // projection invariant (maintained in a different package).
      if (block.redacted && block.encrypted) {
        return { type: 'redacted_thinking', data: block.encrypted };
      }
      if (block.signature) {
        return { type: 'thinking', thinking: block.text, signature: block.signature };
      }
      return null;
  }
}

export interface ToAnthropicToolsOptions {
  /** Place a cache breakpoint on the last tool, caching the whole tools array. */
  readonly cacheLast?: boolean;
}

export function toAnthropicTools(
  tools: ReadonlyArray<ToolDef>,
  opts: ToAnthropicToolsOptions = {},
): AnthropicToolDef[] {
  const out = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputJsonSchema ?? zodToJsonSchema(t.inputSchema),
  })) as AnthropicToolDef[];
  if (opts.cacheLast && out.length > 0) {
    const last = out[out.length - 1];
    assertDefined(last, 'out is non-empty (length > 0 checked above)');
    last.cache_control = { type: 'ephemeral' };
  }
  return out;
}
