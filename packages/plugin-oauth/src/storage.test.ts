import { describe, expect, it } from 'vitest';
import {
  clearStoredCreds,
  isExpired,
  readStoredCreds,
  storeTokenSet,
  validateProvider,
  type OAuthVault,
} from './storage.js';
import type { TokenSet } from './flow.js';

interface FakeVault extends OAuthVault {
  readonly store: Map<string, string>;
}

function makeVault(): FakeVault {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
    },
    delete: async (k) => store.delete(k),
  };
}

const META = { clientId: 'client-1', tokenUrl: 'https://idp.example/token' };

describe('isExpired — hostile / corrupt expiry data degrades to a refresh', () => {
  it('treats a token with no expiresAt as non-expiring', () => {
    expect(isExpired({ accessToken: 'a', tokenType: 'Bearer' })).toBe(false);
  });

  it('treats a NaN expiresAt as EXPIRED, never as eternally fresh', () => {
    // The trap: `Date.now() + skew >= NaN` is always false. A bare `>=` would
    // mark a token with corrupt expiry as forever-valid and suppress every
    // refresh — the user silently presents a possibly-dead token. It must read
    // as expired so the caller refreshes (or fails loudly with AUTH_EXPIRED).
    expect(isExpired({ accessToken: 'a', tokenType: 'Bearer', expiresAt: NaN })).toBe(true);
  });

  it('treats an Infinity expiresAt as EXPIRED (non-finite is corrupt)', () => {
    expect(
      isExpired({ accessToken: 'a', tokenType: 'Bearer', expiresAt: Number.POSITIVE_INFINITY }),
    ).toBe(true);
  });

  it('honours the skew window for a finite expiresAt', () => {
    const soon = Date.now() + 30_000; // 30s out, inside the default 60s skew
    expect(isExpired({ accessToken: 'a', tokenType: 'Bearer', expiresAt: soon })).toBe(true);
    const far = Date.now() + 3_600_000;
    expect(isExpired({ accessToken: 'a', tokenType: 'Bearer', expiresAt: far })).toBe(false);
    expect(isExpired({ accessToken: 'a', tokenType: 'Bearer', expiresAt: far }, 0)).toBe(false);
  });
});

describe('readStoredCreds — sanitizes a corrupt persisted expires_at', () => {
  it('drops a non-numeric expires_at instead of carrying NaN into the TokenSet', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      'p',
      { accessToken: 'a', tokenType: 'Bearer', expiresAt: 123 },
      META,
    );
    // Simulate corruption / a hand-edit / a partial flush on disk.
    vault.store.set('oauth/p/expires_at', 'not-a-number');

    const creds = await readStoredCreds(vault, 'p');
    expect(creds).not.toBeNull();
    // Poison must not survive: expiresAt is omitted, not NaN.
    expect(creds?.tokenSet.expiresAt).toBeUndefined();
    expect(Number.isNaN(creds?.tokenSet.expiresAt as number)).toBe(false);
  });

  it('round-trips a finite expires_at unchanged', async () => {
    const vault = makeVault();
    const at = Date.now() + 1_000_000;
    await storeTokenSet(vault, 'p', { accessToken: 'a', tokenType: 'Bearer', expiresAt: at }, META);
    const creds = await readStoredCreds(vault, 'p');
    expect(creds?.tokenSet.expiresAt).toBe(at);
  });

  it('returns null when setup-meta (client_id/token_url) is missing — partial store is unusable', async () => {
    const vault = makeVault();
    vault.store.set('oauth/p/access_token', 'a'); // access token only, no client_id/token_url
    expect(await readStoredCreds(vault, 'p')).toBeNull();
  });
});

describe('readStoredCreds — parseExtras tolerates hostile / malformed JSON', () => {
  async function seedExtras(raw: string): Promise<TokenSet | undefined> {
    const vault = makeVault();
    await storeTokenSet(vault, 'p', { accessToken: 'a', tokenType: 'Bearer' }, META);
    vault.store.set('oauth/p/extras', raw);
    const creds = await readStoredCreds(vault, 'p');
    return creds?.tokenSet;
  }

  it('does not throw on invalid JSON in extras — degrades to {}', async () => {
    const vault = makeVault();
    await storeTokenSet(vault, 'p', { accessToken: 'a', tokenType: 'Bearer' }, META);
    vault.store.set('oauth/p/extras', '{not json');
    const creds = await readStoredCreds(vault, 'p');
    expect(creds?.extras).toEqual({});
  });

  it('ignores a JSON array (non-object) in extras', async () => {
    await seedExtras('[1,2,3]');
    const vault = makeVault();
    await storeTokenSet(vault, 'p', { accessToken: 'a', tokenType: 'Bearer' }, META);
    vault.store.set('oauth/p/extras', '["evil"]');
    const creds = await readStoredCreds(vault, 'p');
    expect(creds?.extras).toEqual({});
  });

  it('keeps only string-valued fields from an extras object', async () => {
    const vault = makeVault();
    await storeTokenSet(vault, 'p', { accessToken: 'a', tokenType: 'Bearer' }, META);
    vault.store.set(
      'oauth/p/extras',
      JSON.stringify({ account_id: 'acc-1', n: 42, nested: { x: 1 }, ok: 'yes' }),
    );
    const creds = await readStoredCreds(vault, 'p');
    expect(creds?.extras).toEqual({ account_id: 'acc-1', ok: 'yes' });
  });
});

describe('storeTokenSet — mirrors the live TokenSet (deletes stale optional keys)', () => {
  it('clears a previously-stored expires_at/scope/id_token when the new set omits them', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      'p',
      {
        accessToken: 'a1',
        refreshToken: 'r1',
        expiresAt: Date.now() + 1000,
        scope: 'a b',
        idToken: 'idt',
        tokenType: 'Bearer',
      },
      META,
    );
    expect(vault.store.has('oauth/p/expires_at')).toBe(true);
    expect(vault.store.has('oauth/p/scope')).toBe(true);
    expect(vault.store.has('oauth/p/id_token')).toBe(true);

    // A refresh that returns only access_token (RFC 6749 §5.1 permits this).
    await storeTokenSet(vault, 'p', { accessToken: 'a2', tokenType: 'Bearer' }, META);
    expect(vault.store.has('oauth/p/expires_at')).toBe(false);
    expect(vault.store.has('oauth/p/scope')).toBe(false);
    expect(vault.store.has('oauth/p/id_token')).toBe(false);
    expect(vault.store.get('oauth/p/access_token')).toBe('a2');
  });
});

describe('validateProvider — rejects keys that could escape the vault namespace', () => {
  it('rejects path-traversal and separator characters', () => {
    for (const bad of ['../etc', 'a/b', 'a b', 'UPPER', 'a:b', '', 'a\\b']) {
      expect(() => validateProvider(bad)).toThrow();
    }
  });

  it('storeTokenSet / readStoredCreds / clearStoredCreds all reject a bad provider', async () => {
    const vault = makeVault();
    await expect(
      storeTokenSet(vault, '../escape', { accessToken: 'a', tokenType: 'Bearer' }, META),
    ).rejects.toThrow();
    await expect(readStoredCreds(vault, 'a/b')).rejects.toThrow();
    await expect(clearStoredCreds(vault, 'a b')).rejects.toThrow();
  });
});

describe('clearStoredCreds — counts only the keys actually removed', () => {
  it('removes every persisted key and reports the count', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      'p',
      { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now(), scope: 's', tokenType: 'Bearer' },
      { ...META, extras: { account_id: 'x' } },
    );
    const removed = await clearStoredCreds(vault, 'p');
    expect(removed).toBeGreaterThan(0);
    expect(await readStoredCreds(vault, 'p')).toBeNull();
    // Nothing left under the namespace.
    expect([...vault.store.keys()].filter((k) => k.startsWith('oauth/p/'))).toEqual([]);
  });
});
