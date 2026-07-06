import { describe, expect, it } from 'vitest';
import { MAX_INBOUND_TEXT_CHARS, messageSchema } from './schema.js';

describe('messageSchema', () => {
  it('accepts a well-formed new-message payload', () => {
    const parsed = messageSchema.safeParse({
      guid: 'msg-1',
      tempGuid: 'temp-abc',
      text: 'hello',
      isFromMe: false,
      handle: { address: '+15551234567' },
      chats: [{ guid: 'iMessage;-;+15551234567' }],
      dateCreated: 1_700_000_000_000,
      // an un-modeled extra passes through untouched
      subject: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.guid).toBe('msg-1');
      expect(parsed.data.text).toBe('hello');
    }
  });

  it('rejects a payload with no guid', () => {
    expect(messageSchema.safeParse({ text: 'hi', chats: [] }).success).toBe(false);
  });

  it('rejects non-object payloads', () => {
    expect(messageSchema.safeParse(null).success).toBe(false);
    expect(messageSchema.safeParse('garbage').success).toBe(false);
    expect(messageSchema.safeParse(42).success).toBe(false);
  });

  it('rejects a numeric text (wrong type)', () => {
    expect(messageSchema.safeParse({ guid: 'm', text: 42 }).success).toBe(false);
  });

  it('rejects oversized text', () => {
    const parsed = messageSchema.safeParse({
      guid: 'm',
      text: 'a'.repeat(MAX_INBOUND_TEXT_CHARS + 1),
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a chat entry without a guid', () => {
    expect(messageSchema.safeParse({ guid: 'm', chats: [{ chatIdentifier: 'x' }] }).success).toBe(
      false,
    );
  });
});
