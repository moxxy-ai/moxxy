import { describe, expect, it } from 'vitest';
import { E164_RE, normalizeSender, parseAllowedSenders } from './keys.js';

describe('E164_RE', () => {
  it('accepts plausible numbers and rejects junk', () => {
    expect(E164_RE.test('+15551234567')).toBe(true);
    expect(E164_RE.test('+4915771234567')).toBe(true);
    expect(E164_RE.test('15551234567')).toBe(false);
    expect(E164_RE.test('+0155')).toBe(false);
    expect(E164_RE.test('+1555123456789012345')).toBe(false);
    expect(E164_RE.test('')).toBe(false);
  });
});

describe('normalizeSender', () => {
  it('lowercases UUIDs but preserves numbers', () => {
    expect(normalizeSender(' +15551234567 ')).toBe('+15551234567');
    expect(normalizeSender('AB0F5EAD-0000-4000-8000-00805F9B34FB')).toBe(
      'ab0f5ead-0000-4000-8000-00805f9b34fb',
    );
  });
});

describe('parseAllowedSenders', () => {
  it('parses a JSON array of numbers/uuids', () => {
    const raw = JSON.stringify(['+15551234567', 'AB0F5EAD-0000-4000-8000-00805F9B34FB']);
    expect(parseAllowedSenders(raw)).toEqual([
      '+15551234567',
      'ab0f5ead-0000-4000-8000-00805f9b34fb',
    ]);
  });

  it('fails closed on corrupt values', () => {
    expect(parseAllowedSenders(null)).toEqual([]);
    expect(parseAllowedSenders('')).toEqual([]);
    expect(parseAllowedSenders('not json')).toEqual([]);
    expect(parseAllowedSenders('"a string"')).toEqual([]);
    expect(parseAllowedSenders('{"a":1}')).toEqual([]);
  });

  it('drops entries that are neither E.164 nor uuid', () => {
    const raw = JSON.stringify(['+15551234567', 'bob', 42, '../../etc/passwd']);
    expect(parseAllowedSenders(raw)).toEqual(['+15551234567']);
  });
});
