import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MoxxyError } from '@moxxy/sdk';
import { buildOauthGetTokenTool } from './tools.js';
import { storeTokenSet, readStoredCreds, type OAuthVault } from './storage.js';

// oauth_get_token's refresh path takes the same cross-process lockfile under
// `<moxxy home>/locks` that ensure-fresh.ts uses; point MOXXY_HOME at a temp
// dir so tests never touch the real ~/.moxxy.
let moxxyHomeTmp: string;
const priorMoxxyHome = process.env.MOXXY_HOME;
beforeAll(async () => {
  moxxyHomeTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-oauth-tools-'));
  process.env.MOXXY_HOME = moxxyHomeTmp;
});
afterAll(async () => {
  if (priorMoxxyHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = priorMoxxyHome;
  await fs.rm(moxxyHomeTmp, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

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

const PROVIDER = 'test-rotating';
const META = { clientId: 'client-1', tokenUrl: 'https://idp.example/token' };

function tokenResponse(obj: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  } as unknown as Response;
}

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };
const fakeCtx = { signal: new AbortController().signal, logger: noopLogger } as never;

async function seedExpired(vault: OAuthVault, refreshToken: string): Promise<void> {
  await storeTokenSet(
    vault,
    PROVIDER,
    { accessToken: 'old', refreshToken, expiresAt: Date.now() - 1000, tokenType: 'Bearer' },
    META,
  );
}

describe('oauth_get_token — per-credential refresh serialization (u91-1)', () => {
  it('coalesces concurrent refreshes into one IdP call; all callers end with the SAME rotated token', async () => {
    const vault = makeVault();
    await seedExpired(vault, 'r-old');
    let refreshCalls = 0;
    // Token endpoint that ROTATES the refresh_token every call AND rejects a
    // stale (already-spent) one with invalid_grant — i.e. exactly the
    // single-use-rotating refresh_token the lock exists to protect.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const rt = new URLSearchParams(String(init?.body ?? '')).get('refresh_token') ?? '';
        if (rt !== 'r-old') {
          return tokenResponse({ error: 'invalid_grant' }, 400);
        }
        refreshCalls++;
        return tokenResponse({ access_token: 'new', refresh_token: 'r-new', expires_in: 3600 });
      }),
    );

    const tool = buildOauthGetTokenTool({ vault: vault as never });
    const [a, b] = await Promise.all([
      tool.handler({ provider: PROVIDER }, fakeCtx),
      tool.handler({ provider: PROVIDER }, fakeCtx),
    ]);

    // Exactly one network refresh; the loser re-read the winner's rotated token
    // under the lock instead of burning the now-dead one.
    expect(refreshCalls).toBe(1);
    expect((a as Record<string, unknown>).accessToken).toBe('new');
    expect((b as Record<string, unknown>).accessToken).toBe('new');
    expect(vault.store.get(`oauth/${PROVIDER}/refresh_token`)).toBe('r-new');
  });

  it('recovers from invalid_grant by retrying once with the refresh_token another process rotated in', async () => {
    const vault = makeVault();
    await seedExpired(vault, 'r-dead');
    const attempted: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const rt = new URLSearchParams(String(init?.body ?? '')).get('refresh_token') ?? '';
        attempted.push(rt);
        if (rt === 'r-dead') {
          // Another moxxy rotated the stored bundle after we read it.
          vault.store.set(`oauth/${PROVIDER}/refresh_token`, 'r-fresh');
          return tokenResponse({ error: 'invalid_grant' }, 400);
        }
        return tokenResponse({ access_token: 'new-2', refresh_token: 'r-next', expires_in: 3600 });
      }),
    );

    const tool = buildOauthGetTokenTool({ vault: vault as never });
    const res = await tool.handler({ provider: PROVIDER }, fakeCtx);

    expect(attempted).toEqual(['r-dead', 'r-fresh']);
    expect((res as Record<string, unknown>).accessToken).toBe('new-2');
    expect(vault.store.get(`oauth/${PROVIDER}/refresh_token`)).toBe('r-next');
  });

  it('still returns a fresh cached token without any network call (valid existing flow)', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      PROVIDER,
      { accessToken: 'still-good', refreshToken: 'r1', expiresAt: Date.now() + 3_600_000, tokenType: 'Bearer' },
      META,
    );
    const fetchSpy = vi.fn(async () => tokenResponse({ access_token: 'should-not-happen' }));
    vi.stubGlobal('fetch', fetchSpy);

    const tool = buildOauthGetTokenTool({ vault: vault as never });
    const res = await tool.handler({ provider: PROVIDER }, fakeCtx);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect((res as Record<string, unknown>).accessToken).toBe('still-good');
  });

  it('throws AUTH_NO_CREDENTIALS when nothing is stored', async () => {
    const vault = makeVault();
    const tool = buildOauthGetTokenTool({ vault: vault as never });
    const err = await tool.handler({ provider: PROVIDER }, fakeCtx).catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('AUTH_NO_CREDENTIALS');
  });

  it('preserves stored extras (account_id) across a tool-driven refresh', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      PROVIDER,
      { accessToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() - 1000, tokenType: 'Bearer' },
      { ...META, extras: { account_id: 'acct-123' } },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tokenResponse({ access_token: 'new', refresh_token: 'r-new', expires_in: 3600 })),
    );

    const tool = buildOauthGetTokenTool({ vault: vault as never });
    await tool.handler({ provider: PROVIDER }, fakeCtx);

    const reread = await readStoredCreds(vault, PROVIDER);
    expect(reread?.extras.account_id).toBe('acct-123');
  });
});

describe('storeTokenSet — clears stale optional fields on partial refresh (u91-2)', () => {
  it('drops a stale expires_at / id_token / scope when the refreshed set omits them', async () => {
    const vault = makeVault();
    // First store: a full token set with expiry, id_token and scope.
    await storeTokenSet(
      vault,
      PROVIDER,
      {
        accessToken: 'a1',
        refreshToken: 'r1',
        expiresAt: Date.now() + 3_600_000,
        scope: 'openid email',
        tokenType: 'Bearer',
        idToken: 'old.id.token',
      },
      META,
    );
    expect(vault.store.has(`oauth/${PROVIDER}/expires_at`)).toBe(true);
    expect(vault.store.has(`oauth/${PROVIDER}/id_token`)).toBe(true);
    expect(vault.store.has(`oauth/${PROVIDER}/scope`)).toBe(true);

    // Refresh response omits expires_in, id_token and scope (common: many IdPs
    // don't re-issue an id_token on refresh). The caller preserves the prior
    // refresh_token per RFC 6749 §6.
    await storeTokenSet(
      vault,
      PROVIDER,
      { accessToken: 'a2', refreshToken: 'r1', tokenType: 'Bearer' },
      META,
    );

    // Stale keys must be gone — not left pointing at dead data.
    expect(vault.store.has(`oauth/${PROVIDER}/expires_at`)).toBe(false);
    expect(vault.store.has(`oauth/${PROVIDER}/id_token`)).toBe(false);
    expect(vault.store.has(`oauth/${PROVIDER}/scope`)).toBe(false);

    const reread = await readStoredCreds(vault, PROVIDER);
    expect(reread?.tokenSet.accessToken).toBe('a2');
    expect(reread?.tokenSet.expiresAt).toBeUndefined();
    expect(reread?.tokenSet.idToken).toBeUndefined();
    expect(reread?.tokenSet.scope).toBeUndefined();
    // refresh_token preserved (the caller merged the prior one before storing).
    expect(reread?.tokenSet.refreshToken).toBe('r1');
  });

  it('still writes optional fields when the new set provides them (valid full refresh)', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      PROVIDER,
      { accessToken: 'a1', refreshToken: 'r1', expiresAt: 111, scope: 'a', tokenType: 'Bearer', idToken: 'id1' },
      META,
    );
    await storeTokenSet(
      vault,
      PROVIDER,
      { accessToken: 'a2', refreshToken: 'r2', expiresAt: 222, scope: 'a b', tokenType: 'Bearer', idToken: 'id2' },
      META,
    );
    const reread = await readStoredCreds(vault, PROVIDER);
    expect(reread?.tokenSet.expiresAt).toBe(222);
    expect(reread?.tokenSet.scope).toBe('a b');
    expect(reread?.tokenSet.idToken).toBe('id2');
    expect(reread?.tokenSet.refreshToken).toBe('r2');
  });
});
