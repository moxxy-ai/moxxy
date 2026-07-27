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

// The case a key-name-only redactor left wide open: a Bash `command` is not a
// secret-named field, so the permission dialog printed the bearer token
// verbatim into scrollback. That is the exact string the dialog exists to show
// a human, on a terminal that may be recorded or screen-shared.
describe('secret-shaped values inside ordinary fields', () => {
  it('masks a bearer token in a Bash command', () => {
    const out = JSON.stringify(
      redactSecrets({ command: 'curl -H "Authorization: Bearer sk-ant-api03-SECRET123456" https://x' }),
    );
    expect(out).not.toContain('SECRET123456');
    expect(out).toContain('[redacted]');
    // The attempt stays legible: a reviewer must still see that a request with
    // an auth header was proposed.
    expect(out).toContain('curl');
  });

  it('masks credentials embedded in a URL argument', () => {
    const out = JSON.stringify(redactSecrets({ url: 'https://alice:hunter2@internal/api' }));
    expect(out).not.toContain('hunter2');
  });

  it('still masks secret-named fields outright', () => {
    expect(redactSecrets({ apiKey: 'sk-anything' })).toEqual({ apiKey: '[redacted]' });
  });
});
