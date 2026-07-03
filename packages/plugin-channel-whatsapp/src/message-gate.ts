import { z } from 'zod';
import { normalizeJid } from './keys.js';
import type { WaInboundMessage } from './socket.js';

/**
 * The single inbound gate every session-reaching path goes through (AGENTS.md:
 * gate EVERY session-reaching path behind pairing; A8: zod-validate inbound
 * before it touches the session). Pure — the channel feeds it the message plus
 * its identity/allow-list state and branches on the verdict.
 *
 * Order of checks (each is load-bearing):
 *  1. only `notify` upserts — history syncs / appends are not fresh input.
 *  2. shape-validate + size-cap the consumed fields (zod).
 *  3. drop own echoes: Baileys receives this client's OWN outbound sends back
 *     via `messages.upsert`; without the sent-id check the bot replies to
 *     itself in a loop.
 *  4. drop `fromMe` messages outside the owner's self-chat ("Note to Self"):
 *     those are the owner talking to OTHER people from their phone — the bot
 *     must never treat someone's private conversation as a prompt.
 *  5. allow-list by normalized JID: the owner's self-chat is allowed by
 *     default (seeded by the channel); everything else must be explicitly
 *     allow-listed. Unauthorized senders are dropped SILENTLY — replying would
 *     both leak the bot's existence and look like spam (ban risk).
 */

/** Cap on inbound prompt text (WhatsApp itself allows ~65k). */
export const MAX_TEXT_CHARS = 16_000;
/** Cap on a voice note / audio file we will download + buffer for transcription. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const keySchema = z.object({
  remoteJid: z.string().min(1).max(256),
  fromMe: z.boolean().nullish(),
  id: z.string().min(1).max(256).nullish(),
});

const audioMessageSchema = z.object({
  mimetype: z.string().max(256).nullish(),
  fileLength: z.union([z.number(), z.string(), z.object({}).passthrough()]).nullish(),
  seconds: z.number().nullish(),
  ptt: z.boolean().nullish(),
});

export type GateVerdict =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly kind: 'text'; readonly jid: string; readonly text: string }
  | {
      readonly ok: true;
      readonly kind: 'audio';
      readonly jid: string;
      readonly mimeType: string;
      readonly declaredBytes: number | null;
    };

export interface GateState {
  /** The linked account's own normalized JID (null until the socket opens). */
  readonly ownJid: string | null;
  /** Normalized JIDs allowed to drive the session (includes ownJid). */
  readonly allowedJids: ReadonlySet<string>;
  /** Message ids of THIS client's own recent sends (echo/loop protection). */
  readonly isOwnSend: (messageId: string) => boolean;
}

export function gateInboundMessage(
  state: GateState,
  upsertType: string,
  raw: WaInboundMessage,
): GateVerdict {
  if (upsertType !== 'notify') return drop('not a live notify upsert');

  const key = keySchema.safeParse(raw?.key ?? {});
  if (!key.success) return drop('invalid message key shape');
  const { remoteJid, fromMe, id } = key.data;
  if (remoteJid === 'status@broadcast') return drop('status broadcast');

  const jid = normalizeJid(remoteJid);
  if (!jid) return drop('unparseable chat JID');

  if (id && state.isOwnSend(id)) return drop('own outbound echo');

  if (fromMe) {
    // Same-account messages: only the owner's self-chat is a prompt surface.
    if (state.ownJid == null || jid !== state.ownJid) {
      return drop('own message in a foreign chat');
    }
  } else if (!state.allowedJids.has(jid)) {
    return drop('sender not allow-listed');
  }

  const content = unwrapMessageContent(raw?.message ?? null);
  if (!content) return drop('no message content');

  const text = extractText(content);
  if (text != null) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return drop('empty text');
    if (trimmed.length > MAX_TEXT_CHARS) return drop('text over size cap');
    return { ok: true, kind: 'text', jid, text: trimmed };
  }

  const audioRaw = content['audioMessage'];
  if (audioRaw != null && typeof audioRaw === 'object') {
    const audio = audioMessageSchema.safeParse(audioRaw);
    if (!audio.success) return drop('invalid audio message shape');
    const declaredBytes = toFiniteNumber(audio.data.fileLength);
    if (declaredBytes != null && declaredBytes > MAX_AUDIO_BYTES) {
      return drop('audio over size cap');
    }
    return {
      ok: true,
      kind: 'audio',
      jid,
      mimeType: normalizeMime(audio.data.mimetype),
      declaredBytes,
    };
  }

  return drop('unsupported message type');
}

function drop(reason: string): GateVerdict {
  return { ok: false, reason };
}

/**
 * Unwrap the containers WhatsApp nests real content in (disappearing-message
 * chats wrap everything in `ephemeralMessage`, view-once in `viewOnceMessage*`).
 * Bounded depth — malformed nesting must not recurse forever.
 */
function unwrapMessageContent(
  message: Record<string, unknown> | null,
): Record<string, unknown> | null {
  let current = message;
  for (let depth = 0; current != null && depth < 4; depth++) {
    const wrapper =
      pickInner(current, 'ephemeralMessage') ??
      pickInner(current, 'viewOnceMessage') ??
      pickInner(current, 'viewOnceMessageV2') ??
      pickInner(current, 'documentWithCaptionMessage');
    if (!wrapper) return current;
    current = wrapper;
  }
  return current;
}

function pickInner(
  container: Record<string, unknown>,
  field: string,
): Record<string, unknown> | null {
  const wrapper = container[field];
  if (wrapper == null || typeof wrapper !== 'object') return null;
  const inner = (wrapper as { message?: unknown }).message;
  return inner != null && typeof inner === 'object' ? (inner as Record<string, unknown>) : null;
}

function extractText(content: Record<string, unknown>): string | null {
  const conversation = content['conversation'];
  if (typeof conversation === 'string') return conversation;
  const extended = content['extendedTextMessage'];
  if (extended != null && typeof extended === 'object') {
    const text = (extended as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return null;
}

/** `fileLength` arrives as number, decimal string, or a Long-like object. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (value != null && typeof value === 'object') {
    const n = Number((value as { toString(): string }).toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeMime(mime: string | null | undefined): string {
  const trimmed = mime?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'audio/ogg; codecs=opus';
}
