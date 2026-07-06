import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { storeTokenSet, type OAuthVault } from '@moxxy/plugin-oauth';
import type { ProviderAuthContext } from '@moxxy/sdk';
import { assertDefined } from '@moxxy/sdk';
import { CLAUDE_CLIENT_ID, CLAUDE_TOKEN_URL } from './constants.js';
import {
  claudeLogin,
  claudeLogout,
  claudeStatus,
  ensureFreshClaudeTokens,
  refreshClaudeAccessToken,
  __setClaudeFetch,
  __setClaudeOpenBrowser,
  __setClaudeSleep,
  __setClaudeTimeoutMs,
} from './login.js';

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

function makeCtx(vault: OAuthVault, answers: string[]): ProviderAuthContext {
  const queue = [...answers];
  return {
    vault,
    headless: false,
    write: () => {},
    prompt: async () => queue.shift() ?? '',
  };
}

function jsonResponse(obj: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  } as unknown as Response;
}

const META = { clientId: CLAUDE_CLIENT_ID, tokenUrl: CLAUDE_TOKEN_URL };

// The refresh path takes a cross-process lockfile under `<moxxy home>/locks`;
// point MOXXY_HOME at a temp dir so tests never touch the real ~/.moxxy.
let moxxyHomeTmp: string;
const priorMoxxyHome = process.env.MOXXY_HOME;
beforeAll(async () => {
  moxxyHomeTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-claude-login-'));
  process.env.MOXXY_HOME = moxxyHomeTmp;
});
afterAll(async () => {
  if (priorMoxxyHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = priorMoxxyHome;
  await fs.rm(moxxyHomeTmp, { recursive: true, force: true });
});

beforeEach(() => {
  __setClaudeOpenBrowser(async () => {});
  __setClaudeSleep(async () => {}); // don't actually back off under test
  __setClaudeTimeoutMs(50); // bound the hung-connection tests; default is 30s
  __setClaudeFetch(async () => {
    throw new Error('unexpected fetch — a test forgot to stub __setClaudeFetch');
  });
});

/**
 * A fetch that respects the `AbortSignal` exactly like the real one: it never
 * resolves on its own, so it only settles when the per-attempt deadline aborts
 * it (mirroring a half-open socket / black-holing proxy).
 */
function hangingFetch(): typeof fetch {
  return ((_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      });
    })) as typeof fetch;
}

afterAll(() => {
  __setClaudeFetch(fetch);
  __setClaudeTimeoutMs(30_000);
});

describe('claudeLogin', () => {
  it('stores a pasted `setup-token` verbatim, with no refresh token', async () => {
    const vault = makeVault();
    const res = await claudeLogin(makeCtx(vault, ['sk-ant-oat-PASTED']));
    expect(vault.store.get('oauth/claude-code/access_token')).toBe('sk-ant-oat-PASTED');
    expect(vault.store.has('oauth/claude-code/refresh_token')).toBe(false);
    expect(res).toEqual({});
  });

  it('runs the out-of-band flow and exchanges the pasted code for tokens', async () => {
    const vault = makeVault();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    __setClaudeFetch(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        token_type: 'Bearer',
        account: { email_address: 'me@example.com' },
      });
    });

    // First prompt empty => browser flow; second prompt => the auth code.
    const res = await claudeLogin(makeCtx(vault, ['', 'AUTHCODE']));

    expect(calls).toHaveLength(1);
    const call0 = calls[0];
    assertDefined(call0, 'one call asserted above');
    expect(call0.url).toBe(CLAUDE_TOKEN_URL);
    expect(call0.body).toMatchObject({
      grant_type: 'authorization_code',
      code: 'AUTHCODE',
      client_id: CLAUDE_CLIENT_ID,
      redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
    });
    expect(typeof call0.body.code_verifier).toBe('string');
    expect(vault.store.get('oauth/claude-code/access_token')).toBe('access-1');
    expect(vault.store.get('oauth/claude-code/refresh_token')).toBe('refresh-1');
    expect(vault.store.get('oauth/claude-code/extras')).toContain('me@example.com');
    expect(res.accountId).toBe('me@example.com');
  });

  it('retries a transient 5xx from the token endpoint and then succeeds', async () => {
    const vault = makeVault();
    let calls = 0;
    __setClaudeFetch(async () => {
      calls++;
      if (calls < 3) return jsonResponse({ error: { type: 'api_error', message: 'Internal server error' } }, 500);
      return jsonResponse({ access_token: 'access-after-retry', token_type: 'Bearer', expires_in: 3600 });
    });

    const res = await claudeLogin(makeCtx(vault, ['', 'AUTHCODE']));

    expect(calls).toBe(3); // two 500s, third attempt wins
    expect(vault.store.get('oauth/claude-code/access_token')).toBe('access-after-retry');
    expect(res.expiresAt).toBeGreaterThan(0);
  });

  it('does NOT retry a deterministic 4xx — surfaces it immediately', async () => {
    const vault = makeVault();
    let calls = 0;
    __setClaudeFetch(async () => {
      calls++;
      return jsonResponse({ error: { type: 'invalid_request', message: 'invalid_grant' } }, 400);
    });

    await expect(claudeLogin(makeCtx(vault, ['', 'AUTHCODE']))).rejects.toThrow(/HTTP 400/);
    expect(calls).toBe(1);
  });

  it('gives a transient-retry hint after exhausting attempts on persistent 5xx', async () => {
    const vault = makeVault();
    let calls = 0;
    __setClaudeFetch(async () => {
      calls++;
      return jsonResponse({ error: { type: 'api_error', message: 'Internal server error' } }, 500);
    });

    await expect(claudeLogin(makeCtx(vault, ['', 'AUTHCODE']))).rejects.toThrow(/after 3 attempts/);
    expect(calls).toBe(3);
  });

  it('splits a pasted `code#state` and rejects a mismatched state', async () => {
    const vault = makeVault();
    // The internally-generated state will never equal "WRONG", so this must throw.
    await expect(claudeLogin(makeCtx(vault, ['', 'THECODE#WRONGSTATE']))).rejects.toThrow(/state/i);
  });

  it('omits expiresAt entirely for a pasted setup-token (no false "expired")', async () => {
    const vault = makeVault();
    const res = await claudeLogin(makeCtx(vault, ['sk-ant-oat-PASTED']));
    // Absent expiry must be omitted, not collapsed to 0 (which reads as expired).
    expect('expiresAt' in res).toBe(false);
  });

  it('omits expiresAt when the token response has no expires_in', async () => {
    const vault = makeVault();
    __setClaudeFetch(async () =>
      jsonResponse({ access_token: 'access-noexp', refresh_token: 'r', token_type: 'Bearer' }),
    );
    const res = await claudeLogin(makeCtx(vault, ['', 'AUTHCODE']));
    expect(res.accountId).toBeUndefined();
    expect('expiresAt' in res).toBe(false);
  });

  it('treats a 200 with a non-JSON body as transient and retries', async () => {
    const vault = makeVault();
    let calls = 0;
    __setClaudeFetch(async () => {
      calls++;
      if (calls < 2) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON');
          },
          text: async () => '<html>captive portal</html>',
        } as unknown as Response;
      }
      return jsonResponse({ access_token: 'recovered', token_type: 'Bearer', expires_in: 3600 });
    });

    const res = await claudeLogin(makeCtx(vault, ['', 'AUTHCODE']));
    expect(calls).toBe(2); // bad 200 retried, second attempt wins
    expect(vault.store.get('oauth/claude-code/access_token')).toBe('recovered');
    expect(res.expiresAt).toBeGreaterThan(0);
  });

  it('surfaces a transient-retry hint when every 200 body is non-JSON', async () => {
    const vault = makeVault();
    let calls = 0;
    __setClaudeFetch(async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
        text: async () => '',
      } as unknown as Response;
    });
    await expect(claudeLogin(makeCtx(vault, ['', 'AUTHCODE']))).rejects.toThrow(/after 3 attempts/);
    expect(calls).toBe(3);
  });

  it('treats a 200 JSON primitive/array body as transient and retries', async () => {
    const vault = makeVault();
    let calls = 0;
    __setClaudeFetch(async () => {
      calls++;
      if (calls < 2) return jsonResponse([] as unknown, 200); // array, not an object
      return jsonResponse({ access_token: 'after-array', token_type: 'Bearer', expires_in: 3600 });
    });
    const res = await claudeLogin(makeCtx(vault, ['', 'AUTHCODE']));
    expect(calls).toBe(2);
    expect(res.expiresAt).toBeGreaterThan(0);
  });

  it('aborts a hung connection on the per-attempt deadline and retries', async () => {
    const vault = makeVault();
    const hang = hangingFetch();
    let calls = 0;
    __setClaudeFetch(async (url, init) => {
      calls++;
      // First attempt: a half-open socket that never responds — must be aborted
      // by the deadline (not hang forever), reclassified as a transient, retried.
      if (calls < 2) return hang(url, init);
      return jsonResponse({ access_token: 'after-timeout', token_type: 'Bearer', expires_in: 3600 });
    });

    const res = await claudeLogin(makeCtx(vault, ['', 'AUTHCODE']));
    expect(calls).toBe(2);
    expect(vault.store.get('oauth/claude-code/access_token')).toBe('after-timeout');
    expect(res.expiresAt).toBeGreaterThan(0);
  });

  it('surfaces the transient-retry hint when every attempt hangs past the deadline', async () => {
    const vault = makeVault();
    const hang = hangingFetch();
    let calls = 0;
    __setClaudeFetch((url, init) => {
      calls++;
      return hang(url, init);
    });
    await expect(claudeLogin(makeCtx(vault, ['', 'AUTHCODE']))).rejects.toThrow(/after 3 attempts/);
    expect(calls).toBe(3);
  });

  it('refuses without a TTY prompt', async () => {
    const vault = makeVault();
    const ctx: ProviderAuthContext = { vault, headless: true, write: () => {} };
    await expect(claudeLogin(ctx)).rejects.toThrow(/interactive terminal/i);
  });
});

describe('token lifecycle', () => {
  it('ensureFreshClaudeTokens returns null when nothing is stored', async () => {
    expect(await ensureFreshClaudeTokens(makeVault())).toBeNull();
  });

  it('ensureFreshClaudeTokens returns a non-expired token without refreshing', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      'claude-code',
      { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, tokenType: 'Bearer' },
      META,
    );
    // __setClaudeFetch is the throwing default — proving no refresh happens.
    const fresh = await ensureFreshClaudeTokens(vault);
    expect(fresh).toMatchObject({ accessToken: 'a', canRefresh: true });
  });

  it('ensureFreshClaudeTokens refreshes + persists when expired', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      'claude-code',
      { accessToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() - 1000, tokenType: 'Bearer' },
      META,
    );
    __setClaudeFetch(async (_url, init) => {
      expect(JSON.parse(String(init?.body ?? '{}'))).toMatchObject({
        grant_type: 'refresh_token',
        refresh_token: 'r-old',
      });
      return jsonResponse({ access_token: 'new', refresh_token: 'r-new', expires_in: 3600, token_type: 'Bearer' });
    });
    const fresh = await ensureFreshClaudeTokens(vault);
    expect(fresh?.accessToken).toBe('new');
    // Rotated refresh token persisted before returning.
    expect(vault.store.get('oauth/claude-code/refresh_token')).toBe('r-new');
  });

  it('coalesces concurrent refreshes — one IdP call, both consumers get the rotated token', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      'claude-code',
      { accessToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() - 1000, tokenType: 'Bearer' },
      META,
    );
    let refreshCalls = 0;
    __setClaudeFetch(async () => {
      refreshCalls++;
      return jsonResponse({ access_token: 'new', refresh_token: 'r-new', expires_in: 3600, token_type: 'Bearer' });
    });

    const [a, b] = await Promise.all([
      ensureFreshClaudeTokens(vault),
      ensureFreshClaudeTokens(vault),
    ]);

    // The single-use refresh_token must be burned exactly once; the loser of
    // the race re-reads the winner's rotated bundle under the lock.
    expect(refreshCalls).toBe(1);
    expect(a?.accessToken).toBe('new');
    expect(b?.accessToken).toBe('new');
    expect(vault.store.get('oauth/claude-code/refresh_token')).toBe('r-new');
  });

  it('recovers from invalid_grant by retrying once with the refresh_token another process rotated in', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      'claude-code',
      { accessToken: 'old', refreshToken: 'r-dead', expiresAt: Date.now() - 1000, tokenType: 'Bearer' },
      META,
    );
    const attempted: string[] = [];
    __setClaudeFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { refresh_token?: string };
      attempted.push(body.refresh_token ?? '');
      if (body.refresh_token === 'r-dead') {
        // Simulate the cross-process race: another moxxy already rotated the
        // stored bundle, so OUR copy of the refresh token is single-use-spent.
        vault.store.set('oauth/claude-code/refresh_token', 'r-fresh');
        return jsonResponse({ error: 'invalid_grant' }, 400);
      }
      return jsonResponse({ access_token: 'new-2', refresh_token: 'r-next', expires_in: 3600, token_type: 'Bearer' });
    });

    const res = await refreshClaudeAccessToken(vault);

    expect(attempted).toEqual(['r-dead', 'r-fresh']);
    expect(res.token).toBe('new-2');
    expect(vault.store.get('oauth/claude-code/refresh_token')).toBe('r-next');
  });

  it('does NOT retry an invalid_grant when the stored refresh_token is unchanged (true re-auth case)', async () => {
    const vault = makeVault();
    await storeTokenSet(
      vault,
      'claude-code',
      { accessToken: 'old', refreshToken: 'r-revoked', expiresAt: Date.now() - 1000, tokenType: 'Bearer' },
      META,
    );
    let calls = 0;
    __setClaudeFetch(async () => {
      calls++;
      return jsonResponse({ error: 'invalid_grant' }, 400);
    });
    await expect(refreshClaudeAccessToken(vault)).rejects.toThrow(/HTTP 400/);
    expect(calls).toBe(1);
  });

  it('refreshClaudeAccessToken throws when no refresh_token is stored', async () => {
    const vault = makeVault();
    await storeTokenSet(vault, 'claude-code', { accessToken: 'a', tokenType: 'Bearer' }, META);
    await expect(refreshClaudeAccessToken(vault)).rejects.toThrow(/refresh/i);
  });

  it('claudeStatus / claudeLogout report and clear stored creds', async () => {
    const vault = makeVault();
    const ctx = makeCtx(vault, []);
    await storeTokenSet(
      vault,
      'claude-code',
      { accessToken: 'a', expiresAt: Date.now() + 1000, tokenType: 'Bearer' },
      { ...META, extras: { account_email: 'me@example.com' } },
    );
    const status = await claudeStatus(ctx);
    expect(status).toMatchObject({ accountId: 'me@example.com' });
    expect(await claudeLogout(ctx)).toBe(true);
    expect(await claudeStatus(ctx)).toBeNull();
  });

  it('claudeStatus omits expiresAt for a stored setup-token (no false "expired")', async () => {
    const vault = makeVault();
    const ctx = makeCtx(vault, []);
    // A pasted setup-token has no expiry — status must not surface 0/epoch.
    await storeTokenSet(vault, 'claude-code', { accessToken: 'a', tokenType: 'Bearer' }, META);
    const status = await claudeStatus(ctx);
    expect(status).not.toBeNull();
    expect('expiresAt' in (status as object)).toBe(false);
  });
});
