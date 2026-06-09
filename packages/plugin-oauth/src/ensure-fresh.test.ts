import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureFreshTokens } from './ensure-fresh.js';
import { withCredentialLock } from './credential-lock.js';
import { storeTokenSet, type OAuthVault } from './storage.js';
import type { OAuthProviderProfile } from './profile.js';

// The refresh path takes a cross-process lockfile under `<moxxy home>/locks`;
// point MOXXY_HOME at a temp dir so tests never touch the real ~/.moxxy.
let moxxyHomeTmp: string;
const priorMoxxyHome = process.env.MOXXY_HOME;
beforeAll(async () => {
  moxxyHomeTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-ensure-fresh-'));
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

const profile: OAuthProviderProfile = {
  id: 'test-rotating',
  displayName: 'Test',
  authUrl: 'https://idp.example/authorize',
  tokenUrl: 'https://idp.example/token',
  clientId: 'client-1',
  scopes: ['openid'],
};

const META = { clientId: profile.clientId, tokenUrl: profile.tokenUrl };

function tokenResponse(obj: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  } as unknown as Response;
}

async function seedExpired(vault: OAuthVault, refreshToken: string): Promise<void> {
  await storeTokenSet(
    vault,
    profile.id,
    { accessToken: 'old', refreshToken, expiresAt: Date.now() - 1000, tokenType: 'Bearer' },
    META,
  );
}

describe('ensureFreshTokens — rotating refresh-token serialization', () => {
  it('coalesces concurrent refreshes into one IdP call; both consumers get the rotated token', async () => {
    const vault = makeVault();
    await seedExpired(vault, 'r-old');
    let refreshCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        refreshCalls++;
        return tokenResponse({ access_token: 'new', refresh_token: 'r-new', expires_in: 3600 });
      }),
    );

    const [a, b] = await Promise.all([
      ensureFreshTokens(profile, vault),
      ensureFreshTokens(profile, vault),
    ]);

    expect(refreshCalls).toBe(1);
    expect(a.tokens.accessToken).toBe('new');
    expect(b.tokens.accessToken).toBe('new');
    expect(vault.store.get(`oauth/${profile.id}/refresh_token`)).toBe('r-new');
  });

  it('force=true coalesces too when another refresher already rotated the token', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      profile.id,
      { accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() + 3_600_000, tokenType: 'Bearer' },
      META,
    );
    let refreshCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        refreshCalls++;
        return tokenResponse({ access_token: `a${refreshCalls + 1}`, refresh_token: `r${refreshCalls + 1}`, expires_in: 3600 });
      }),
    );

    // Two 401-recovery refreshes racing: the loser must reuse the winner's
    // rotated token instead of burning the single-use refresh_token again.
    const [a, b] = await Promise.all([
      ensureFreshTokens(profile, vault, { force: true }),
      ensureFreshTokens(profile, vault, { force: true }),
    ]);

    expect(refreshCalls).toBe(1);
    expect(a.tokens.accessToken).toBe('a2');
    expect(b.tokens.accessToken).toBe('a2');
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
          // Simulate the cross-process race: another moxxy rotated the stored
          // bundle after we read it, so OUR refresh token is already spent.
          vault.store.set(`oauth/${profile.id}/refresh_token`, 'r-fresh');
          return tokenResponse({ error: 'invalid_grant' }, 400);
        }
        return tokenResponse({ access_token: 'new-2', refresh_token: 'r-next', expires_in: 3600 });
      }),
    );

    const res = await ensureFreshTokens(profile, vault);

    expect(attempted).toEqual(['r-dead', 'r-fresh']);
    expect(res.tokens.accessToken).toBe('new-2');
    expect(vault.store.get(`oauth/${profile.id}/refresh_token`)).toBe('r-next');
  });

  it('does NOT retry an invalid_grant when the stored refresh_token is unchanged (true re-auth case)', async () => {
    const vault = makeVault();
    await seedExpired(vault, 'r-revoked');
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return tokenResponse({ error: 'invalid_grant' }, 400);
      }),
    );
    await expect(ensureFreshTokens(profile, vault)).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });
});

describe('withCredentialLock', () => {
  it('serializes same-key sections and runs different keys independently', async () => {
    const order: string[] = [];
    const gate = new Promise<void>((r) => setTimeout(r, 30));
    const first = withCredentialLock('lock-test-a', async () => {
      order.push('a1-start');
      await gate;
      order.push('a1-end');
    });
    const second = withCredentialLock('lock-test-a', async () => {
      order.push('a2');
    });
    const other = withCredentialLock('lock-test-b', async () => {
      order.push('b');
    });
    await Promise.all([first, second, other]);
    // b (different key) is free to run before a1 finishes; a2 is not.
    expect(order.indexOf('a1-end')).toBeLessThan(order.indexOf('a2'));
  });

  it('creates and removes an O_EXCL lockfile in the lock dir', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-lockdir-'));
    let seenDuring: string[] = [];
    await withCredentialLock(
      'lock-test-file',
      async () => {
        seenDuring = await fs.readdir(dir);
      },
      { dir },
    );
    expect(seenDuring).toEqual(['lock-test-file.lock']);
    expect(await fs.readdir(dir)).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('takes over a stale lockfile left behind by a crashed holder', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-lockstale-'));
    const lockPath = path.join(dir, 'lock-test-stale.lock');
    await fs.writeFile(lockPath, '999999 crashed\n');
    const old = new Date(Date.now() - 120_000);
    await fs.utimes(lockPath, old, old);

    let ran = false;
    await withCredentialLock(
      'lock-test-stale',
      async () => {
        ran = true;
      },
      { dir, staleMs: 60_000, pollMs: 5, waitMs: 500 },
    );
    expect(ran).toBe(true);
    expect(await fs.readdir(dir)).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('proceeds without the lock (best effort) when a live holder outlasts waitMs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-lockwait-'));
    const lockPath = path.join(dir, 'lock-test-held.lock');
    await fs.writeFile(lockPath, `${process.pid} live\n`); // fresh mtime = live holder
    let ran = false;
    await withCredentialLock(
      'lock-test-held',
      async () => {
        ran = true;
      },
      { dir, staleMs: 60_000, pollMs: 5, waitMs: 50 },
    );
    expect(ran).toBe(true);
    // The foreign lockfile must be left alone (we never owned it).
    expect(await fs.readdir(dir)).toEqual(['lock-test-held.lock']);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
