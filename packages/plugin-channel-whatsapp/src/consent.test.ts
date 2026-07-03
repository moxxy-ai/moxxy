import { afterEach, describe, expect, it } from 'vitest';
import { WHATSAPP_CONSENT_ENV, WHATSAPP_CONSENT_KEY } from './keys.js';
import { hasConsent, recordConsent, type ConsentVault } from './consent.js';

function fakeVault(initial: Record<string, string> = {}): ConsentVault & {
  store: Record<string, string>;
} {
  const store = { ...initial };
  return {
    store,
    async get(name) {
      return store[name] ?? null;
    },
    async set(name, value) {
      store[name] = value;
    },
  };
}

afterEach(() => {
  delete process.env[WHATSAPP_CONSENT_ENV];
});

describe('consent gate', () => {
  it('is false with no receipt and no env override', async () => {
    expect(await hasConsent(fakeVault())).toBe(false);
    expect(await hasConsent(undefined)).toBe(false);
  });

  it('honors the env override even without a vault', async () => {
    process.env[WHATSAPP_CONSENT_ENV] = 'yes';
    expect(await hasConsent(undefined)).toBe(true);
  });

  it('does NOT accept a "no" env value', async () => {
    process.env[WHATSAPP_CONSENT_ENV] = 'no';
    expect(await hasConsent(fakeVault())).toBe(false);
  });

  it('accepts a recorded vault receipt', async () => {
    const vault = fakeVault();
    await recordConsent(vault);
    expect(vault.store[WHATSAPP_CONSENT_KEY]).toMatch(/^acknowledged@/);
    expect(await hasConsent(vault)).toBe(true);
  });

  it('treats a vault read error as no consent', async () => {
    const vault: ConsentVault = {
      async get() {
        throw new Error('vault locked');
      },
      async set() {},
    };
    expect(await hasConsent(vault)).toBe(false);
  });
});
