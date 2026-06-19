import { describe, expect, it } from 'vitest';
import { isSecretKey, redactSecrets, REDACTED_PLACEHOLDER } from './redact.js';

describe('redactSecrets — masks secret-named field VALUES before display', () => {
  it('masks common secret keys, preserves non-secret fields', () => {
    const out = redactSecrets({
      apiKey: 'sk-live-DEADBEEF',
      token: 'ghp_supersecret',
      password: 'hunter2',
      url: 'https://example.com',
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe(REDACTED_PLACEHOLDER);
    expect(out.token).toBe(REDACTED_PLACEHOLDER);
    expect(out.password).toBe(REDACTED_PLACEHOLDER);
    expect(out.url).toBe('https://example.com');
  });

  it('matches case-insensitively and hyphen/underscore variants', () => {
    const out = redactSecrets({
      API_KEY: 'a',
      'access-key': 'b',
      Authorization: 'Bearer xyz',
      privateKey: 'c',
    }) as Record<string, unknown>;
    expect(out.API_KEY).toBe(REDACTED_PLACEHOLDER);
    expect(out['access-key']).toBe(REDACTED_PLACEHOLDER);
    expect(out.Authorization).toBe(REDACTED_PLACEHOLDER);
    expect(out.privateKey).toBe(REDACTED_PLACEHOLDER);
  });

  it('redacts secrets nested inside objects and arrays', () => {
    const out = redactSecrets({
      headers: { authorization: 'Bearer leaky' },
      list: [{ token: 'nested' }],
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain('Bearer leaky');
    expect(s).not.toContain('nested');
    expect(s).toContain(REDACTED_PLACEHOLDER);
  });

  it('does not blow the stack on a pathologically deep input', () => {
    let deep: Record<string, unknown> = { secret: 'x' };
    for (let i = 0; i < 10000; i += 1) deep = { nested: deep };
    expect(() => redactSecrets(deep)).not.toThrow();
  });

  it('passes through primitives untouched (no object to walk)', () => {
    expect(redactSecrets('plain')).toBe('plain');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
  });
});

describe('isSecretKey', () => {
  it('flags secret-bearing names, ignores ordinary ones', () => {
    expect(isSecretKey('apiKey')).toBe(true);
    expect(isSecretKey('ACCESS_KEY')).toBe(true);
    expect(isSecretKey('bearer')).toBe(true);
    expect(isSecretKey('file_path')).toBe(false);
    expect(isSecretKey('query')).toBe(false);
  });
});
