import { describe, expect, it } from 'vitest';
import { MoxxyError } from '@moxxy/sdk';
import { formatErrorForCli } from './error-formatter.js';

// Strip ANSI so the assertions don't have to encode color codes.
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('formatErrorForCli', () => {
  it('renders MoxxyError with code + message + hint', () => {
    const err = new MoxxyError({
      code: 'NETWORK_UNREACHABLE',
      message: "Couldn't reach api.anthropic.com.",
      hint: 'Check your internet connection.',
    });
    const out = strip(formatErrorForCli(err));
    expect(out).toContain('error [NETWORK_UNREACHABLE]');
    expect(out).toContain("Couldn't reach api.anthropic.com.");
    expect(out).toContain('hint: Check your internet connection.');
  });

  it('omits hint line when none is provided', () => {
    const err = new MoxxyError({ code: 'INTERNAL', message: 'oops' });
    const out = strip(formatErrorForCli(err));
    expect(out).toContain('error [INTERNAL]  oops');
    expect(out).not.toContain('hint:');
  });

  it('preserves the VaultPassphraseError multi-line message', () => {
    const err = new Error('Wrong vault passphrase for /tmp/vault.\nrm /tmp/vault and retry');
    err.name = 'VaultPassphraseError';
    const out = strip(formatErrorForCli(err));
    expect(out).toContain('Wrong vault passphrase');
    expect(out).toContain('rm /tmp/vault');
    expect(out).not.toContain('error [');
  });

  it('falls back to "error: <message>" for unknown errors', () => {
    const out = strip(formatErrorForCli(new Error('something bad')));
    expect(out).toBe('error: something bad');
  });

  it('dumps context + cause chain when debug=true', () => {
    const cause = new Error('inner');
    const err = new MoxxyError({
      code: 'NETWORK_UNREACHABLE',
      message: 'down',
      hint: 'try later',
      context: { url: 'https://x', status: 0 },
      cause,
    });
    const out = strip(formatErrorForCli(err, { debug: true }));
    expect(out).toContain('context: url=https://x status=0');
    expect(out).toContain('caused by Error: inner');
  });

  it('caps the cause chain at 5 links on a very deep chain', () => {
    // Build a 7-deep cause chain; only the first 5 links should be rendered.
    let cause: Error | undefined;
    for (let i = 7; i >= 1; i -= 1) {
      const e = new Error(`level ${i}`);
      if (cause) (e as { cause?: unknown }).cause = cause;
      cause = e;
    }
    const err = new MoxxyError({ code: 'INTERNAL', message: 'top', cause });
    const out = strip(formatErrorForCli(err, { debug: true }));
    const links = out.split('\n').filter((l) => l.includes('caused by'));
    expect(links).toHaveLength(5);
  });

  it('redacts secret-looking context keys under debug', () => {
    const err = new MoxxyError({
      code: 'AUTH_NO_CREDENTIALS',
      message: 'denied',
      context: {
        provider: 'anthropic',
        apiKey: 'sk-super-secret',
        authorization: 'Bearer leaked',
        token: 'tok_leaked',
      },
    });
    const out = strip(formatErrorForCli(err, { debug: true }));
    expect(out).toContain('provider=anthropic');
    expect(out).not.toContain('sk-super-secret');
    expect(out).not.toContain('Bearer leaked');
    expect(out).not.toContain('tok_leaked');
    expect(out).toContain('apiKey=[redacted]');
  });

  it('truncates an enormous context value so it cannot flood stderr', () => {
    const huge = 'x'.repeat(5000);
    const err = new MoxxyError({ code: 'INTERNAL', message: 'big', context: { body: huge } });
    const out = strip(formatErrorForCli(err, { debug: true }));
    expect(out).not.toContain(huge);
    expect(out).toContain('5000 chars');
  });

  it('does not hang on a self-referential cause chain', () => {
    const a = new Error('loop');
    (a as { cause?: unknown }).cause = a;
    const err = new MoxxyError({ code: 'INTERNAL', message: 'top', cause: a });
    const out = strip(formatErrorForCli(err, { debug: true }));
    // The depth cap bounds the self-loop to exactly 5 rendered links.
    const links = out.split('\n').filter((l) => l.includes('caused by'));
    expect(links).toHaveLength(5);
  });
});
