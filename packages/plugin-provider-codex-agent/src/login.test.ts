import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderAuthContext } from '@moxxy/sdk';
import { __setCodexCommandRunner, checkCodexAuth, codexLogin, codexLogout, codexStatus, resolveCodexExecutable } from './login.js';

function ctx(extra: Partial<ProviderAuthContext> = {}): ProviderAuthContext {
  return {
    headless: false,
    write: () => {},
    vault: { get: async () => null, set: async () => {}, delete: async () => false },
    ...extra,
  };
}

const run = (stdout: string, code = 0, stderr = '') => Promise.resolve({ code, stdout, stderr });

beforeEach(() => {
  delete process.env.CODEX_EXECUTABLE;
});

afterAll(() => {
  __setCodexCommandRunner(async () => ({ code: 1, stdout: '', stderr: 'not configured' }));
});

describe('Codex sign-in, read from the person own Codex', () => {
  it('reads a ChatGPT sign-in from `codex login status`', async () => {
    const calls: string[][] = [];
    __setCodexCommandRunner(async (_exe, args) => {
      calls.push([...args]);
      return run('Logged in using ChatGPT\n');
    });
    await expect(checkCodexAuth()).resolves.toMatchObject({ state: 'signed-in', executable: 'codex', accountId: 'ChatGPT' });
    expect(calls).toEqual([['login', 'status']]);
  });

  it('reads a signed-out Codex', async () => {
    __setCodexCommandRunner(async () => run('', 1, 'Not logged in\n'));
    await expect(checkCodexAuth()).resolves.toMatchObject({ state: 'signed-out' });
  });

  it('says Codex is missing when it is not installed', async () => {
    __setCodexCommandRunner(async () => ({ code: 1, stdout: '', stderr: '', error: Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }) }));
    await expect(checkCodexAuth()).resolves.toMatchObject({ state: 'missing', message: expect.stringContaining('CODEX_EXECUTABLE') });
  });

  it('uses the configured Codex, then CODEX_EXECUTABLE, then codex on PATH', () => {
    expect(resolveCodexExecutable({ executable: '/opt/codex' })).toBe('/opt/codex');
    process.env.CODEX_EXECUTABLE = '/env/codex';
    expect(resolveCodexExecutable()).toBe('/env/codex');
    delete process.env.CODEX_EXECUTABLE;
    expect(resolveCodexExecutable()).toBe('codex');
  });

  it('signs in with Codex own `codex login` only when signed out, and checks it worked', async () => {
    const calls: string[][] = [];
    __setCodexCommandRunner(async (_exe, args) => {
      calls.push([...args]);
      if (args[0] === 'login' && args.length === 1) return run('Successfully logged in\n');
      return calls.length > 2 ? run('Logged in using ChatGPT\n') : run('', 1, 'Not logged in\n');
    });
    await expect(codexLogin(ctx())).resolves.toEqual({ accountId: 'ChatGPT' });
    expect(calls).toEqual([['login', 'status'], ['login'], ['login', 'status']]);
  });

  it('in the desktop, hands the sign-in page to the desktop to open', async () => {
    const urls: string[] = [];
    let signedIn = false;
    __setCodexCommandRunner(async (_exe, args, opts) => {
      if (args.length === 1) {
        opts?.onOutput?.('Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?client_id=app_x&state=s\n');
        signedIn = true;
        return run('');
      }
      return signedIn ? run('Logged in using ChatGPT\n') : run('', 1, 'Not logged in\n');
    });
    await codexLogin(ctx({ noOpen: true, onAuthUrl: (url) => urls.push(url) }));
    expect(urls).toEqual(['https://auth.openai.com/oauth/authorize?client_id=app_x&state=s']);
  });

  it('signs out with `codex logout`', async () => {
    const calls: string[][] = [];
    __setCodexCommandRunner(async (_exe, args) => {
      calls.push([...args]);
      return args[0] === 'logout' ? run('Successfully logged out\n') : run('Logged in using ChatGPT\n');
    });
    await expect(codexLogout(ctx())).resolves.toBe(true);
    expect(calls).toEqual([['login', 'status'], ['logout']]);
  });

  it('reports the state for status surfaces', async () => {
    __setCodexCommandRunner(async () => run('', 1, 'Not logged in\n'));
    await expect(codexStatus(ctx())).resolves.toMatchObject({ authState: 'signed-out', accountId: null });
  });
});
