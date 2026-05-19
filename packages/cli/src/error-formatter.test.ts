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
});
