import type { MoxxyEvent, UserPromptAttachment } from './events.js';

/**
 * Attachment bytes travel two very different roads. The model needs them in
 * full; a client that only DRAWS the conversation (desktop, mobile, a channel
 * bot) does not, and pushing a scanned 30 MB PDF through the client link on
 * every reconnect is what once wedged a chat in a reconnect loop. So the runner
 * sends clients {@link eventForClient} — large payloads swapped for their size —
 * and a client that wants the bytes (an image preview) reads them back in
 * bounded slices with {@link readAttachmentChunk}. The log itself never changes.
 */

/**
 * The most attachment payload (base64 characters) one model request carries.
 * Every request resends the whole conversation, so without a cap a chat with a
 * few scanned PDFs outgrows the provider's request limit (Anthropic: 32 MB) and
 * EVERY later turn fails. The newest attachments go in full; older ones that no
 * longer fit become a note naming them.
 */
export const MODEL_ATTACHMENT_BUDGET_CHARS = 20 * 1024 * 1024;

/** One attachment's payload above this travels to clients by size only. */
export const CLIENT_INLINE_ATTACHMENT_CHARS = 512 * 1024;
/** All of one event's inline attachment payloads together stay under this. */
export const CLIENT_INLINE_EVENT_CHARS = 1024 * 1024;
/** The largest slice one attachment read returns. */
export const ATTACHMENT_READ_CHUNK_CHARS = 1024 * 1024;

/** Whether `content` is base64 bytes rather than text. Raw audio carries a media type; a transcript does not. */
function isBase64Payload(att: UserPromptAttachment): boolean {
  return att.kind === 'image' || att.kind === 'document' || (att.kind === 'audio' && att.mediaType !== undefined);
}

/** The attachment's size in bytes — its real size even on a client copy whose bytes were left out. */
export function attachmentBytes(att: UserPromptAttachment): number {
  if (att.omittedBytes !== undefined) return att.omittedBytes;
  if (!isBase64Payload(att)) return att.content.length;
  const padding = att.content.endsWith('==') ? 2 : att.content.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((att.content.length * 3) / 4) - padding);
}

/**
 * The copy of `event` a client receives: every attachment payload too large for
 * the client link becomes `content: ''` plus `omittedBytes`. Returns `event`
 * itself when nothing had to change, so the common case allocates nothing.
 */
export function eventForClient(event: MoxxyEvent): MoxxyEvent {
  if (event.type !== 'user_prompt' || !event.attachments || event.attachments.length === 0) return event;
  let room = CLIENT_INLINE_EVENT_CHARS;
  let changed = false;
  const attachments = event.attachments.map((att) => {
    const size = att.content.length;
    if (size <= CLIENT_INLINE_ATTACHMENT_CHARS && size <= room) {
      room -= size;
      return att;
    }
    changed = true;
    return { ...att, content: '', omittedBytes: attachmentBytes(att) };
  });
  return changed ? { ...event, attachments } : event;
}

/**
 * The most one history page may weigh on the wire, in JSON characters. Paging
 * counts events, and a few hundred events with screenshots or attachments can
 * add up to tens of megabytes — one frame the client has to swallow whole.
 */
export const HISTORY_PAGE_MAX_CHARS = 4 * 1024 * 1024;

/** One newest-first history page: ascending events plus the cursor to the next older page. */
export interface HistoryPage {
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly prevCursor: number | null;
}

/**
 * The page as a client receives it: every event in its client form, and the
 * oldest events dropped until the page fits {@link HISTORY_PAGE_MAX_CHARS}. The
 * newest event always stays, so paging always advances; the dropped events
 * come back on the next older page.
 */
export function historyPageForClient(page: HistoryPage): HistoryPage {
  const events = page.events.map(eventForClient);
  let room = HISTORY_PAGE_MAX_CHARS;
  let start = events.length;
  while (start > 0) {
    const event = events[start - 1];
    if (event === undefined) break;
    const size = JSON.stringify(event).length + 1;
    if (size > room && start < events.length) break;
    room -= size;
    start -= 1;
  }
  if (start === 0) return { events, prevCursor: page.prevCursor };
  const kept = events.slice(start);
  const oldest = kept[0];
  return { events: kept, prevCursor: oldest === undefined ? page.prevCursor : oldest.seq };
}

/** One slice of an attachment's `content`, starting at `offset` (in characters). */
export interface AttachmentChunk {
  readonly data: string;
  /** The full `content` length, so the reader knows when it has everything. */
  readonly total: number;
}

/**
 * Slice attachment `index` of `event`. Slices start on a multiple of four
 * characters when `offset` does, so base64 slices decode on their own too.
 */
export function readAttachmentChunk(event: MoxxyEvent, index: number, offset: number): AttachmentChunk {
  if (event.type !== 'user_prompt' || !event.attachments) {
    throw new Error(`event ${event.seq} has no attachments`);
  }
  const att = event.attachments[index];
  if (!att) throw new Error(`event ${event.seq} has no attachment ${index}`);
  const start = Math.max(0, Math.floor(offset));
  return { data: att.content.slice(start, start + ATTACHMENT_READ_CHUNK_CHARS), total: att.content.length };
}
