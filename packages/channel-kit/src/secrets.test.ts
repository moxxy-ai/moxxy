import { afterEach, describe, expect, it } from 'vitest';
import { resolveSecret, type SecretReader } from './secrets.js';

const ENV = 'MOXXY_CHANNEL_KIT_TEST_SECRET';

function vaultWith(values: Record<string, string | null>): SecretReader {
  return {
    async get(name) {
      return values[name] ?? null;
    },
  };
}

describe('resolveSecret', () => {
  afterEach(() => {
    delete process.env[ENV];
  });

  it('prefers the env override', async () => {
    process.env[ENV] = 'from-env';
    const got = await resolveSecret(vaultWith({ key: 'from-vault' }), {
      envVar: ENV,
      vaultKey: 'key',
    });
    expect(got).toBe('from-env');
  });

  it('trims the env value', async () => {
    process.env[ENV] = '  padded  ';
    expect(await resolveSecret(vaultWith({}), { envVar: ENV, vaultKey: 'key' })).toBe('padded');
  });

  it('falls through to the vault when the env var is unset or whitespace', async () => {
    expect(
      await resolveSecret(vaultWith({ key: 'from-vault' }), { envVar: ENV, vaultKey: 'key' }),
    ).toBe('from-vault');

    process.env[ENV] = '   ';
    expect(
      await resolveSecret(vaultWith({ key: 'from-vault' }), { envVar: ENV, vaultKey: 'key' }),
    ).toBe('from-vault');
  });

  it('trims the vault value and treats empty as unset', async () => {
    expect(await resolveSecret(vaultWith({ key: '  v  ' }), { vaultKey: 'key' })).toBe('v');
    expect(await resolveSecret(vaultWith({ key: '   ' }), { vaultKey: 'key' })).toBeNull();
  });

  it('returns null when neither source has a value', async () => {
    expect(await resolveSecret(vaultWith({}), { envVar: ENV, vaultKey: 'key' })).toBeNull();
  });

  it('skips the env entirely when no envVar is given', async () => {
    process.env[ENV] = 'should-not-be-read';
    expect(await resolveSecret(vaultWith({ key: 'from-vault' }), { vaultKey: 'key' })).toBe(
      'from-vault',
    );
  });
});
