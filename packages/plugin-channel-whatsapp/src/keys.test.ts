import { describe, expect, it } from 'vitest';
import { isConsentValue, normalizeJid, parseAllowedJids } from './keys.js';

describe('normalizeJid', () => {
  it('strips device + agent suffixes off the user part', () => {
    expect(normalizeJid('15551234567:12@s.whatsapp.net')).toBe('15551234567@s.whatsapp.net');
    expect(normalizeJid('15551234567_1:3@s.whatsapp.net')).toBe('15551234567@s.whatsapp.net');
  });

  it('lowercases the server and keeps a bare jid', () => {
    expect(normalizeJid('15551234567@S.Whatsapp.Net')).toBe('15551234567@s.whatsapp.net');
    expect(normalizeJid('12345@g.us')).toBe('12345@g.us');
  });

  it('rejects garbage and malformed values', () => {
    expect(normalizeJid('')).toBeNull();
    expect(normalizeJid('   ')).toBeNull();
    expect(normalizeJid('nope')).toBeNull();
    expect(normalizeJid('@s.whatsapp.net')).toBeNull();
    expect(normalizeJid('a@@b')).toBeNull();
    expect(normalizeJid('u@bad server')).toBeNull();
    expect(normalizeJid(null)).toBeNull();
    expect(normalizeJid(undefined)).toBeNull();
  });
});

describe('parseAllowedJids', () => {
  it('parses comma/space-separated JIDs and de-dupes/normalizes', () => {
    expect(parseAllowedJids('15551234567@s.whatsapp.net, 15551234567:9@s.whatsapp.net')).toEqual([
      '15551234567@s.whatsapp.net',
    ]);
    expect(parseAllowedJids('a@g.us b@g.us')).toEqual(['a@g.us', 'b@g.us']);
  });

  it('parses a JSON array and drops non-JIDs', () => {
    expect(parseAllowedJids('["1@s.whatsapp.net", "garbage", 42]')).toEqual(['1@s.whatsapp.net']);
  });

  it('returns [] for empty / broken input', () => {
    expect(parseAllowedJids(null)).toEqual([]);
    expect(parseAllowedJids('')).toEqual([]);
    expect(parseAllowedJids('[not json')).toEqual([]);
  });
});

describe('isConsentValue', () => {
  it('accepts an explicit yes or a dated receipt', () => {
    expect(isConsentValue('yes')).toBe(true);
    expect(isConsentValue('YES')).toBe(true);
    expect(isConsentValue('acknowledged@2026-07-03T00:00:00.000Z')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isConsentValue('no')).toBe(false);
    expect(isConsentValue('')).toBe(false);
    expect(isConsentValue(null)).toBe(false);
    expect(isConsentValue('maybe')).toBe(false);
  });
});
