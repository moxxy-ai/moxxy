import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Buffer } from 'node:buffer';
import {
  codexAuthPath,
  readInstalledCodexTokens,
  writeInstalledCodexTokens,
} from './cli-creds.js';

/** Build a minimal JWT carrying just an `exp` (seconds) claim. */
function jwtWithExp(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}

let tmp: string;
const priorCodexHome = process.env.CODEX_HOME;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-'));
  process.env.CODEX_HOME = tmp;
});

afterEach(async () => {
  if (priorCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = priorCodexHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('readInstalledCodexTokens', () => {
  it('honors CODEX_HOME for the auth.json path', () => {
    expect(codexAuthPath()).toBe(path.join(tmp, 'auth.json'));
  });

  it('returns null when auth.json is missing', async () => {
    expect(await readInstalledCodexTokens()).toBeNull();
  });

  it('returns null when the file is malformed', async () => {
    await fs.writeFile(path.join(tmp, 'auth.json'), 'not json', 'utf8');
    expect(await readInstalledCodexTokens()).toBeNull();
  });

  it('returns null when the access/refresh pair is incomplete', async () => {
    await fs.writeFile(
      path.join(tmp, 'auth.json'),
      JSON.stringify({ tokens: { access_token: 'AT' } }),
      'utf8',
    );
    expect(await readInstalledCodexTokens()).toBeNull();
  });

  it('normalizes a full bundle, deriving expiry from the access_token JWT', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await fs.writeFile(
      path.join(tmp, 'auth.json'),
      JSON.stringify({
        OPENAI_API_KEY: null,
        auth_mode: 'chatgpt',
        tokens: {
          access_token: jwtWithExp(exp),
          refresh_token: 'RT',
          account_id: 'acct-123',
        },
        last_refresh: '2026-01-01T00:00:00Z',
      }),
      'utf8',
    );
    const tokens = await readInstalledCodexTokens();
    expect(tokens).toMatchObject({ refresh: 'RT', accountId: 'acct-123', expires: exp * 1000 });
  });
});

describe('writeInstalledCodexTokens', () => {
  it('round-trips a rotated bundle and preserves untouched fields', async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    await fs.writeFile(
      path.join(tmp, 'auth.json'),
      JSON.stringify({
        OPENAI_API_KEY: 'sk-keep',
        auth_mode: 'chatgpt',
        tokens: { access_token: 'OLD', refresh_token: 'OLDR', id_token: 'ID', account_id: 'acct-1' },
        last_refresh: 'old',
      }),
      'utf8',
    );
    await writeInstalledCodexTokens({
      access: jwtWithExp(exp),
      refresh: 'NEWR',
      expires: exp * 1000,
      accountId: 'acct-1',
    });
    const raw = JSON.parse(await fs.readFile(path.join(tmp, 'auth.json'), 'utf8'));
    expect(raw.OPENAI_API_KEY).toBe('sk-keep'); // untouched
    expect(raw.tokens.id_token).toBe('ID'); // preserved
    expect(raw.tokens.refresh_token).toBe('NEWR'); // rotated
    expect(raw.tokens.account_id).toBe('acct-1');
    expect(raw.last_refresh).not.toBe('old'); // bumped
    // And it reads back cleanly.
    const reread = await readInstalledCodexTokens();
    expect(reread).toMatchObject({ refresh: 'NEWR' });
  });

  it('writes a minimal valid file when none exists', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await writeInstalledCodexTokens({ access: jwtWithExp(exp), refresh: 'R', expires: exp * 1000 });
    const reread = await readInstalledCodexTokens();
    expect(reread).toMatchObject({ refresh: 'R' });
  });
});
