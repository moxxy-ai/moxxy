import { describe, expect, it } from 'vitest';
import {
  E164_RE,
  EMAIL_RE,
  isHandle,
  normalizeHandle,
  parseDmChatGuid,
  parseHandleList,
} from './keys.js';

describe('handle shapes', () => {
  it('E164_RE accepts plausible numbers and rejects junk', () => {
    expect(E164_RE.test('+15551234567')).toBe(true);
    expect(E164_RE.test('+4915771234567')).toBe(true);
    expect(E164_RE.test('15551234567')).toBe(false);
    expect(E164_RE.test('+0155')).toBe(false);
    expect(E164_RE.test('')).toBe(false);
  });

  it('EMAIL_RE accepts Apple-ID emails and rejects junk', () => {
    expect(EMAIL_RE.test('friend@icloud.com')).toBe(true);
    expect(EMAIL_RE.test('a.b+c@example.co.uk')).toBe(true);
    expect(EMAIL_RE.test('not-an-email')).toBe(false);
    expect(EMAIL_RE.test('two @spaces.com')).toBe(false);
  });

  it('isHandle recognises numbers and emails only', () => {
    expect(isHandle('+15551234567')).toBe(true);
    expect(isHandle('friend@icloud.com')).toBe(true);
    expect(isHandle('bob')).toBe(false);
    expect(isHandle('../../etc/passwd')).toBe(false);
  });
});

describe('normalizeHandle', () => {
  it('lowercases emails but preserves numbers', () => {
    expect(normalizeHandle(' +15551234567 ')).toBe('+15551234567');
    expect(normalizeHandle('  Friend@ICloud.com ')).toBe('friend@icloud.com');
  });
});

describe('parseHandleList', () => {
  it('parses a JSON array of numbers/emails', () => {
    const raw = JSON.stringify(['+15551234567', 'Friend@iCloud.com']);
    expect(parseHandleList(raw)).toEqual(['+15551234567', 'friend@icloud.com']);
  });

  it('fails closed on missing or corrupt values', () => {
    expect(parseHandleList(null)).toEqual([]);
    expect(parseHandleList(undefined)).toEqual([]);
    expect(parseHandleList('')).toEqual([]);
    expect(parseHandleList('not json')).toEqual([]);
    expect(parseHandleList('"a string"')).toEqual([]);
    expect(parseHandleList('{"a":1}')).toEqual([]);
  });

  it('drops entries that are neither E.164 nor email, and de-dupes', () => {
    const raw = JSON.stringify(['+15551234567', 'bob', 42, '../../etc/passwd', '+15551234567']);
    expect(parseHandleList(raw)).toEqual(['+15551234567']);
  });
});

describe('parseDmChatGuid', () => {
  it('parses a 1:1 chat guid', () => {
    expect(parseDmChatGuid('iMessage;-;+15551234567')).toEqual({
      service: 'iMessage',
      handle: '+15551234567',
    });
    expect(parseDmChatGuid('SMS;-;Friend@iCloud.com')).toEqual({
      service: 'SMS',
      handle: 'friend@icloud.com',
    });
  });

  it('rejects group guids (v1 is DM-only)', () => {
    expect(parseDmChatGuid('iMessage;+;chat1234567890')).toBeNull();
  });

  it('rejects malformed / non-handle guids', () => {
    expect(parseDmChatGuid(null)).toBeNull();
    expect(parseDmChatGuid('')).toBeNull();
    expect(parseDmChatGuid('iMessage;-;')).toBeNull();
    expect(parseDmChatGuid('iMessage;-;not-a-handle')).toBeNull();
    expect(parseDmChatGuid('iMessage;-;+1;extra')).toBeNull();
  });
});
