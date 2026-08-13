import { describe, expect, it } from 'vitest';
import { isSecretKey, redactSecretText, redactSecrets } from './redact.js';

describe('isSecretKey', () => {
  it('recognises the common secret-bearing field names', () => {
    for (const key of ['apiKey', 'api_key', 'SECRET', 'authToken', 'privateKey', 'Authorization']) {
      expect(isSecretKey(key)).toBe(true);
    }
  });

  it('does not flag ordinary fields', () => {
    for (const key of ['command', 'path', 'name', 'monkey']) expect(isSecretKey(key)).toBe(false);
  });
});

describe('redactSecretText', () => {
  // The motivating case: the carrier field is `command`, so key-name redaction
  // alone prints the token verbatim.
  it('masks a bearer token inside a shell command', () => {
    const out = redactSecretText('curl -H "Authorization: Bearer sk-ant-api03-XYZ123456789" https://api');
    expect(out).not.toContain('XYZ123456789');
    expect(out).toContain('[redacted]');
    // The attempt itself must stay visible: an auditor needs to see a header
    // was sent, not just that something was hidden.
    expect(out).toContain('curl');
    expect(out.toLowerCase()).toContain('authorization');
  });

  it('masks vendor key formats wherever they appear', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['sk-ant-api03-ABCDEFGHIJKLMNOP', 'ABCDEFGHIJKLMNOP'],
      ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
      ['xoxb-1234567890-ABCDEFGH', 'ABCDEFGH'],
      ['AKIAIOSFODNN7EXAMPLE', 'IOSFODNN7EXAMPLE'],
      ['AIzaSyA1234567890abcdefghijklmnop', 'SyA1234567890abcdefghijklmnop'],
    ];
    for (const [input, secret] of cases) {
      expect(redactSecretText(`value=${input}`)).not.toContain(secret);
    }
  });

  it('masks a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NX0.SflKxwRJSMeKKF2QT4fwpMeJf36P';
    expect(redactSecretText(`token ${jwt}`)).toContain('[redacted-jwt]');
  });

  it('masks credentials embedded in a URL', () => {
    const out = redactSecretText('https://alice:hunter2@proxy.corp:3128/path');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('proxy.corp');
  });

  it('masks KEY=value style assignments', () => {
    const out = redactSecretText('export GITHUB_TOKEN=abcdef123456 && run');
    expect(out).not.toContain('abcdef123456');
    expect(out).toContain('GITHUB_TOKEN');
  });

  it('leaves ordinary text alone', () => {
    const text = 'ls -la /home/alice && grep -r "monkey" src/';
    expect(redactSecretText(text)).toBe(text);
  });
});

describe('redactSecrets', () => {
  it('drops the value of a secret-named field entirely', () => {
    expect(redactSecrets({ apiKey: 'sk-whatever' })).toEqual({ apiKey: '[redacted]' });
  });

  it('scans ordinary string fields for secret shapes', () => {
    const out = redactSecrets({ command: 'curl -H "Authorization: Bearer sk-ant-ABCDEFGH12345678"' });
    expect(JSON.stringify(out)).not.toContain('ABCDEFGH12345678');
  });

  it('walks arrays and nested objects', () => {
    const out = redactSecrets({ steps: [{ env: { TOKEN: 'ghp_ABCDEFGHIJKLMNOPQRSTUV' } }] });
    expect(JSON.stringify(out)).not.toContain('ABCDEFGHIJKLMNOPQRSTUV');
  });

  it('bounds the walk so a pathological input cannot blow the stack', () => {
    let deep: Record<string, unknown> = { apiKey: 'sk-deep' };
    for (let i = 0; i < 500; i++) deep = { nested: deep };
    expect(() => redactSecrets(deep)).not.toThrow();
  });

  it('passes non-objects through unchanged', () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
  });
});
