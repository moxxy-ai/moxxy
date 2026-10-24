/**
 * What a chat's media library holds, folded event by event from its log: the
 * photos and files the person attached, the images tools showed the agent, and
 * every link a message made clickable. Only the log's own words decide: a page
 * the agent opened without writing its address into the chat is not a link.
 *
 * A link is read with the parser the conversation draws with (GFM, as
 * react-markdown + remark-gfm), so the library holds exactly the links that are
 * clickable in the chat, and none from inside code.
 *
 * Bytes never enter the fold. An entry keeps where its event sits in the log
 * file (`at`) and which of its images it is (`index`), so the bytes are read
 * back from the log only when a thumbnail or a preview needs them.
 *
 * Repeats show once, at their newest. The same bytes are one item whoever sent
 * them. The agent's screenshots go further: a capture of a screen it already
 * showed with identical pixels in a different encoding replaces the earlier
 * one. A person's own photos are never merged by looks:
 * two similar shots sent on purpose are two photos.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod/v3';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { attachmentBytes, toolImagesOf, type MoxxyEvent, type UserPromptAttachment } from '@moxxy/sdk';
import type { ChatMediaItem, ChatMediaOwner } from '@moxxy/desktop-ipc-contract';
import { localMediaFilePath } from './local-file';

/** Where an event's line sits in the log file, in bytes. */
export interface LineAt {
  readonly offset: number;
  readonly length: number;
}

export interface ChatMediaEntry {
  readonly item: ChatMediaItem;
  readonly at: LineAt;
  /** The attachment's or the tool image's position inside its event. */
  readonly index: number;
  /** What an agent image looks like ({@link ImageFingerprint}), to find a repeat of its screen. */
  readonly look?: string;
}

/**
 * The dimensions and exact decoded pixels, as a SHA-256 digest; null when the
 * image cannot be decoded. Similar but different images remain separate.
 */
export type ImageFingerprint = (base64: string) => string | null;

export interface ChatMediaCollectorOptions {
  readonly fingerprint?: ImageFingerprint;
}

export interface ChatMediaState {
  readonly version: typeof STATE_VERSION;
  /** Insertion order is age: a repeat moves its entry to the end. */
  readonly entries: ReadonlyArray<readonly [string, ChatMediaEntry]>;
  /** Calls still waiting on their result, by call id: the words for its images. */
  readonly calls: ReadonlyArray<readonly [string, string]>;
}

const STATE_VERSION = 3;
const itemBase = {
  id: z.string(),
  owner: z.enum(['me', 'agent']),
  seq: z.number().int().nonnegative(),
  ts: z.number().finite(),
  caption: z.string(),
};
const cachedEntry = z.object({
  at: z.object({ offset: z.number().int().nonnegative(), length: z.number().int().nonnegative() }),
  index: z.number().int().nonnegative(),
  look: z.string().optional(),
  item: z.discriminatedUnion('kind', [
    z.object({
      ...itemBase,
      kind: z.literal('image'),
      mediaType: z.string(),
      name: z.string().nullable(),
      bytes: z.number().nonnegative(),
    }),
    z.object({
      ...itemBase,
      kind: z.literal('file'),
      name: z.string(),
      mediaType: z.string().nullable(),
      bytes: z.number().nonnegative().nullable(),
      path: z.string().nullable(),
    }),
    z.object({
      ...itemBase,
      kind: z.literal('link'),
      url: z
        .string()
        .url()
        .refine((url) => /^https?:/.test(url)),
      label: z.string().nullable(),
    }),
  ]),
});
const cachedState = z.object({
  version: z.literal(STATE_VERSION),
  entries: z.array(z.tuple([z.string(), cachedEntry])),
  calls: z.array(z.tuple([z.string(), z.string()])),
});
const CAPTION_CHARS = 300;
/** Calls whose result never came (an aborted turn) must not pile up forever. */
const MAX_PENDING_CALLS = 500;

export class ChatMediaCollector {
  private readonly byKey: Map<string, ChatMediaEntry>;
  private readonly calls: Map<string, string>;
  private readonly fingerprint: ImageFingerprint | undefined;

  constructor(state?: ChatMediaState, options: ChatMediaCollectorOptions = {}) {
    this.byKey = new Map(state?.entries ?? []);
    this.calls = new Map(state?.calls ?? []);
    this.fingerprint = options.fingerprint;
  }

  static fromJSON(raw: unknown, options: ChatMediaCollectorOptions = {}): ChatMediaCollector {
    return new ChatMediaCollector(cachedState.parse(raw), options);
  }

  toJSON(): ChatMediaState {
    return { version: STATE_VERSION, entries: [...this.byKey], calls: [...this.calls] };
  }

  /** Newest first. */
  entries(): ChatMediaEntry[] {
    return [...this.byKey.values()].reverse();
  }

  add(event: MoxxyEvent, at: LineAt): void {
    switch (event.type) {
      case 'user_prompt':
        // A prompt a trigger wrote (a webhook body, a schedule, a voice
        // transcript) is not something the person put into the chat.
        if (event.origin) return;
        this.addAttachments(event, at);
        this.addMarkdown(event.text, 'me', event, at);
        return;
      case 'assistant_message':
        this.addMarkdown(event.content, 'agent', event, at);
        return;
      case 'tool_call_requested':
        this.calls.set(event.callId, captionOf([event.name, ...inputWords(event.input)].join(' ')));
        while (this.calls.size > MAX_PENDING_CALLS) {
          const oldest = this.calls.keys().next().value;
          if (oldest === undefined) break;
          this.calls.delete(oldest);
        }
        return;
      case 'tool_result': {
        const call = this.calls.get(event.callId) ?? '';
        this.calls.delete(event.callId);
        if (!event.ok) return;
        const shown = toolImagesOf(event.output);
        if (!shown) return;
        const caption = captionOf(`${call} ${shown.text}`);
        shown.images.forEach((image, index) => {
          const key = `img:${digest(image.base64)}`;
          const look = this.byKey.has(key) ? undefined : (this.fingerprint?.(image.base64) ?? undefined);
          if (look !== undefined) this.dropSameScreen(look);
          this.put(key, {
            look,
            item: {
              kind: 'image',
              id: `t:${event.seq}:${index}`,
              owner: 'agent',
              seq: event.seq,
              ts: event.ts,
              caption,
              mediaType: image.mediaType,
              name: null,
              bytes: base64Bytes(image.base64),
            },
            at,
            index,
          });
        });
        return;
      }
      default:
        return;
    }
  }

  private addAttachments(event: Extract<MoxxyEvent, { type: 'user_prompt' }>, at: LineAt): void {
    const caption = captionOf(event.text);
    (event.attachments ?? []).forEach((att, index) => {
      const base = {
        owner: 'me' as const,
        seq: event.seq,
        ts: event.ts,
        caption,
        id: `a:${event.seq}:${index}`,
      };
      if (att.kind === 'image' && att.mediaType) {
        this.put(`img:${digest(att.content)}`, {
          item: {
            ...base,
            kind: 'image',
            mediaType: att.mediaType,
            name: att.name ?? null,
            bytes: attachmentBytes(att),
          },
          at,
          index,
        });
      } else if (att.kind === 'document' || att.kind === 'file') {
        const name = attachmentName(att);
        this.put(`att:${name}:${digest(att.content)}`, {
          item: {
            ...base,
            kind: 'file',
            name,
            mediaType: att.mediaType ?? null,
            bytes: attachmentBytes(att),
            path: null,
          },
          at,
          index,
        });
      }
    });
  }

  private addMarkdown(text: string, owner: ChatMediaOwner, event: MoxxyEvent, at: LineAt): void {
    if (!text) return;
    for (const link of linksIn(text)) {
      const base = { owner, seq: event.seq, ts: event.ts, caption: captionOf(link.context) };
      const file = localMediaFilePath(link.url);
      if (file) {
        this.put(`path:${file}`, {
          item: {
            ...base,
            kind: 'file',
            id: `f:${file}`,
            name: path.basename(file),
            mediaType: null,
            bytes: null,
            path: file,
          },
          at,
          index: 0,
        });
        continue;
      }
      // GFM turns the prose word 'www.' into an autolink.
      if (link.label === 'www' && link.url === 'http://www') continue;
      const url = webUrl(link.url);
      if (!url) continue;
      this.put(`url:${url}`, {
        item: { ...base, kind: 'link', id: `l:${url}`, url, label: labelOf(link.label, link.url, url) },
        at,
        index: 0,
      });
    }
  }

  /** Forget the agent's earlier capture of the screen `look` shows: the new one replaces it. */
  private dropSameScreen(look: string): void {
    for (const [key, entry] of this.byKey) {
      if (entry.item.owner !== 'agent' || entry.look === undefined) continue;
      if (entry.look === look) {
        this.byKey.delete(key);
        return;
      }
    }
  }

  /** A repeat moves to the newest place; something the person sent stays theirs. */
  private put(key: string, entry: ChatMediaEntry): void {
    const earlier = this.byKey.get(key);
    this.byKey.delete(key);
    if (!earlier) {
      this.byKey.set(key, entry);
      return;
    }
    const owner: ChatMediaOwner = earlier.item.owner === 'me' ? 'me' : entry.item.owner;
    const look = entry.look ?? earlier.look;
    const item = { ...entry.item, owner } as ChatMediaItem;
    if (item.kind === 'image' && earlier.item.kind === 'image' && item.name === null) {
      this.byKey.set(key, { ...entry, look, item: { ...item, name: earlier.item.name } });
      return;
    }
    this.byKey.set(key, { ...entry, look, item });
  }
}

// ---------- links -------------------------------------------------------------

interface MdNode {
  readonly type: string;
  readonly value?: string;
  readonly url?: string;
  readonly identifier?: string;
  readonly children?: ReadonlyArray<MdNode>;
}

interface FoundLink {
  readonly url: string;
  readonly label: string;
  /** The text of the block the link sits in. */
  readonly context: string;
}

/** Blocks whose text is a link's context. */
const CONTEXT_BLOCKS = new Set(['paragraph', 'heading', 'tableCell']);

function linksIn(markdown: string): FoundLink[] {
  const root: MdNode = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const found: FoundLink[] = [];
  const definitions = new Map<string, string>();
  const define = (node: MdNode): void => {
    if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    for (const child of node.children ?? []) define(child);
  };
  define(root);
  const walk = (node: MdNode, block: MdNode | null): void => {
    const context = CONTEXT_BLOCKS.has(node.type) ? node : block;
    const url =
      node.type === 'link'
        ? node.url
        : node.type === 'linkReference' && node.identifier
          ? definitions.get(node.identifier)
          : undefined;
    if (url) {
      found.push({ url, label: textOf(node), context: context ? textOf(context) : textOf(node) });
      return;
    }
    for (const child of node.children ?? []) walk(child, context);
  };
  walk(root, null);
  return found;
}

function textOf(node: MdNode): string {
  if (node.value !== undefined) return node.value;
  return (node.children ?? []).map(textOf).join('');
}

/** A clickable http(s) address, normalised for deduplication. */
function webUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The link's own words, or null when it shows just its address. */
function labelOf(label: string, raw: string, url: string): string | null {
  const text = label.trim();
  if (!text || text === raw || text === url || `http://${text}` === raw || `${text}/` === url) return null;
  return text;
}

// ---------- small helpers -----------------------------------------------------

function captionOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, CAPTION_CHARS);
}

/** The words of a call's input worth searching by: its short top-level strings. */
function inputWords(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return [];
  return Object.values(input).filter(
    (value): value is string => typeof value === 'string' && value.length <= 300,
  );
}

function attachmentName(att: UserPromptAttachment): string {
  if (att.name) return path.basename(att.name);
  return att.kind === 'document' ? 'document' : 'file';
}

function digest(content: string): string {
  return createHash('sha1').update(content).digest('hex').slice(0, 20);
}

function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}
