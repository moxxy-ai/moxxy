import { describe, expect, it } from 'vitest';

import { assertDefined } from './assert.js';

import {
  ATTACHMENT_READ_CHUNK_CHARS,
  CLIENT_INLINE_ATTACHMENT_CHARS,
  CLIENT_INLINE_EVENT_CHARS,
  HISTORY_PAGE_MAX_CHARS,
  attachmentBytes,
  eventForClient,
  findAttachment,
  historyPageForClient,
  listAttachments,
  readAttachmentChunk,
  restoredAttachmentRef,
} from './attachment-payload.js';
import type { MoxxyEvent, UserPromptAttachment, UserPromptEvent } from './events.js';

function prompt(attachments: ReadonlyArray<UserPromptAttachment>): UserPromptEvent {
  return {
    type: 'user_prompt',
    seq: 7,
    ts: 0,
    turnId: 't1',
    text: 'look at these',
    attachments,
  } as unknown as UserPromptEvent;
}

const base64Of = (chars: number): string => 'A'.repeat(chars);

function firstAttachment(event: UserPromptEvent): UserPromptAttachment {
  const first = event.attachments?.[0];
  assertDefined(first, 'first attachment');
  return first;
}

describe('eventForClient', () => {
  it('leaves an event without large attachments untouched (same object)', () => {
    const event = prompt([{ kind: 'image', content: base64Of(1000), mediaType: 'image/png', name: 'a.png' }]);
    expect(eventForClient(event)).toBe(event);
    const chunk = { type: 'assistant_chunk', seq: 1, ts: 0, turnId: 't1', delta: 'hi' } as unknown as MoxxyEvent;
    expect(eventForClient(chunk)).toBe(chunk);
  });

  it('replaces the bytes of a large attachment with its size, keeping name and type', () => {
    const big = base64Of(CLIENT_INLINE_ATTACHMENT_CHARS + 4);
    const event = prompt([{ kind: 'document', content: big, mediaType: 'application/pdf', name: 'scan.pdf' }]);
    const slim = eventForClient(event) as UserPromptEvent;
    expect(slim).not.toBe(event);
    expect(slim.attachments).toEqual([
      { kind: 'document', content: '', mediaType: 'application/pdf', name: 'scan.pdf', omittedBytes: attachmentBytes(firstAttachment(event)) },
    ]);
    // The original event keeps its bytes — the runner's log is never changed.
    expect(firstAttachment(event).content).toBe(big);
  });

  it('caps the bytes one event carries even when each attachment is small', () => {
    const each = Math.floor(CLIENT_INLINE_ATTACHMENT_CHARS * 0.9);
    const count = Math.ceil(CLIENT_INLINE_EVENT_CHARS / each) + 1;
    const event = prompt(
      Array.from({ length: count }, (_, i) => ({ kind: 'image' as const, content: base64Of(each), mediaType: 'image/png', name: `${i}.png` })),
    );
    const slim = eventForClient(event) as UserPromptEvent;
    const sent = slim.attachments ?? [];
    const inline = sent.reduce((n, a) => n + a.content.length, 0);
    expect(inline).toBeLessThanOrEqual(CLIENT_INLINE_EVENT_CHARS);
    expect(firstAttachment(slim).content.length).toBe(each);
    expect(sent.at(-1)?.omittedBytes).toBeGreaterThan(0);
  });
});

describe('attachmentBytes', () => {
  it('decodes base64 length for binary kinds and reports the omitted size when present', () => {
    expect(attachmentBytes({ kind: 'image', content: 'QUJD', mediaType: 'image/png' })).toBe(3);
    expect(attachmentBytes({ kind: 'image', content: 'QUI=', mediaType: 'image/png' })).toBe(2);
    expect(attachmentBytes({ kind: 'file', content: 'hello' })).toBe(5);
    expect(attachmentBytes({ kind: 'document', content: '', omittedBytes: 1234 })).toBe(1234);
  });
});

describe('readAttachmentChunk', () => {
  it('returns one bounded slice and the total, so a client can rebuild the content', () => {
    const content = base64Of(ATTACHMENT_READ_CHUNK_CHARS * 2 + 10);
    const event = prompt([{ kind: 'document', content, mediaType: 'application/pdf' }]);
    let rebuilt = '';
    let offset = 0;
    for (;;) {
      const chunk = readAttachmentChunk(event, 0, offset);
      expect(chunk.total).toBe(content.length);
      expect(chunk.data.length).toBeLessThanOrEqual(ATTACHMENT_READ_CHUNK_CHARS);
      rebuilt += chunk.data;
      offset += chunk.data.length;
      if (offset >= chunk.total) break;
    }
    expect(rebuilt).toBe(content);
  });

  it('throws for an event or index that has no such attachment', () => {
    const chunk = { type: 'assistant_chunk', seq: 1, ts: 0, turnId: 't1', delta: 'hi' } as unknown as MoxxyEvent;
    expect(() => readAttachmentChunk(chunk, 0, 0)).toThrow(/no attachments/);
    expect(() => readAttachmentChunk(prompt([]), 0, 0)).toThrow(/no attachment 0/);
  });
});

describe('historyPageForClient', () => {
  const text = (seq: number, chars: number): MoxxyEvent =>
    ({ type: 'assistant_message', seq, ts: 0, turnId: 't1', content: 'x'.repeat(chars) }) as unknown as MoxxyEvent;

  it('passes a small page through with its cursor', () => {
    const page = { events: [text(3, 10), text(4, 10)], prevCursor: 3 };
    expect(historyPageForClient(page)).toEqual(page);
  });

  it('drops the oldest events until the page fits, pointing the cursor at the oldest kept', () => {
    const quarter = Math.floor(HISTORY_PAGE_MAX_CHARS / 4);
    const page = historyPageForClient({
      events: [0, 1, 2, 3, 4, 5].map((seq) => text(seq, quarter)),
      prevCursor: null,
    });
    expect(page.events.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(page.prevCursor).toBe(3);
  });

  it('always keeps the newest event so paging advances', () => {
    const page = historyPageForClient({
      events: [text(8, 10), text(9, HISTORY_PAGE_MAX_CHARS * 2)],
      prevCursor: 8,
    });
    expect(page.events.map((e) => e.seq)).toEqual([9]);
    expect(page.prevCursor).toBe(9);
  });
});

describe('finding an earlier attachment', () => {
  const at = (seq: number, attachments: ReadonlyArray<UserPromptAttachment>): MoxxyEvent =>
    ({ ...prompt(attachments), seq }) as MoxxyEvent;
  const events = [
    at(2, [{ kind: 'document', content: 'OLD', mediaType: 'application/pdf', name: 'umowa.pdf' }]),
    at(5, [
      { kind: 'image', content: 'IMG', mediaType: 'image/png', name: 'shot.png' },
      { kind: 'document', content: 'NEW', mediaType: 'application/pdf', name: 'Umowa.pdf' },
    ]),
  ];

  it('finds one by its key or, newest first, by its name whatever the case', () => {
    expect(findAttachment(events, '2:0')).toMatchObject({ seq: 2, index: 0, attachment: { content: 'OLD' } });
    expect(findAttachment(events, 'umowa.pdf')).toMatchObject({ seq: 5, index: 1, attachment: { content: 'NEW' } });
    expect(findAttachment(events, 'shot.png')).toMatchObject({ seq: 5, index: 0 });
    expect(findAttachment(events, 'missing.pdf')).toBeNull();
    expect(findAttachment(events, '9:0')).toBeNull();
  });

  it('lists every attachment of the conversation by key and name', () => {
    expect(listAttachments(events)).toEqual(['2:0 umowa.pdf', '5:0 shot.png', '5:1 Umowa.pdf']);
  });

  it('reads the reference out of a restoring recall result, and nothing out of anything else', () => {
    expect(restoredAttachmentRef({ forModel: 'restored', restoredAttachment: { seq: 2, index: 0 } })).toEqual({ seq: 2, index: 0 });
    expect(restoredAttachmentRef('text')).toBeNull();
    expect(restoredAttachmentRef({ restoredAttachment: { seq: '2', index: 0 } })).toBeNull();
    expect(restoredAttachmentRef(null)).toBeNull();
  });
});
