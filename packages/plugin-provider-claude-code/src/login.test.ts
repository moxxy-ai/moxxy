import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderAuthContext } from '@moxxy/sdk';
import {
  __setClaudeCommandRunner,
  checkClaudeCliAuth,
  claudeLogin,
  claudeLogout,
  claudeStatus,
  resolveClaudeExecutable,
} from './login.js';

function ctx(): ProviderAuthContext {
  const store = new Map<string, string>();
  return {
    headless: false,
    write: () => {},
    vault: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => { store.set(key, value); },
      delete: async (key) => store.delete(key),
    },
  };
}

const ok = (stdout = '', code = 0) => Promise.resolve({ code, stdout, stderr: '' });

beforeEach(() => {
  delete process.env.CLAUDE_CODE_EXECUTABLE;
});

afterAll(() => {
  __setClaudeCommandRunner(async () => ({ code: 1, stdout: '', stderr: 'not configured' }));
});

describe('Claude CLI authentication', () => {
  it('accepts an already authenticated CLI without invoking login', async () => {
    const calls: string[][] = [];
    __setClaudeCommandRunner(async (_exe, args) => {
      calls.push([...args]);
      return ok(JSON.stringify({ loggedIn: true, email: 'me@example.com' }));
    });
    await expect(claudeLogin(ctx())).resolves.toEqual({ accountId: 'me@example.com' });
    expect(calls).toEqual([['auth', 'status']]);
  });

  it('invokes the CLI login flow when signed out and verifies the result', async () => {
    const calls: string[][] = [];
    __setClaudeCommandRunner(async (_exe, args) => {
      calls.push([...args]);
      if (args[1] === 'login') return ok();
      return ok(JSON.stringify({ loggedIn: calls.length > 2, account: 'subscriber@example.com' }));
    });
    await expect(claudeLogin(ctx())).resolves.toEqual({ accountId: 'subscriber@example.com' });
    expect(calls).toEqual([
      ['auth', 'status'],
      ['auth', 'login'],
      ['auth', 'status'],
    ]);
  });

  it('keeps executable paths containing spaces as one spawn argument', async () => {
    process.env.CLAUDE_CODE_EXECUTABLE = '/Applications/Claude Code/bin/claude';
    const executables: string[] = [];
    __setClaudeCommandRunner(async (exe) => {
      executables.push(exe);
      return ok('{"loggedIn":true}');
    });
    await claudeLogin(ctx());
    expect(executables).toEqual(['/Applications/Claude Code/bin/claude']);
    expect(resolveClaudeExecutable({ executable: '/a path/claude' })).toBe('/a path/claude');
  });

  it('distinguishes a missing executable', async () => {
    __setClaudeCommandRunner(async () => ({
      code: 1, stdout: '', stderr: '', error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
    }));
    const status = await checkClaudeCliAuth('/missing/claude');
    expect(status.state).toBe('missing');
    expect(status.message).toMatch(/Install Claude Code/);
  });

  it('distinguishes signed-out and signed-in states', async () => {
    __setClaudeCommandRunner(async () => ok('{"loggedIn":false}'));
    await expect(claudeStatus(ctx())).resolves.toMatchObject({ authState: 'signed-out' });
    __setClaudeCommandRunner(async () => ok('{"loggedIn":true,"email":"x@y.test"}'));
    await expect(claudeStatus(ctx())).resolves.toMatchObject({ authState: 'signed-in', accountId: 'x@y.test' });
  });

  it('reports unsupported CLI versions actionably', async () => {
    __setClaudeCommandRunner(async () => ({ code: 1, stdout: '', stderr: 'unknown command auth' }));
    const status = await checkClaudeCliAuth();
    expect(status.state).toBe('unsupported');
    expect(status.message).toMatch(/Update Claude Code/);
  });

  it('surfaces command failures without treating them as signed-out', async () => {
    __setClaudeCommandRunner(async () => ({ code: 2, stdout: '', stderr: 'config is corrupt' }));
    const status = await checkClaudeCliAuth();
    expect(status.state).toBe('error');
    await expect(claudeLogin(ctx())).rejects.toThrow(/config is corrupt/);
  });

  it('logs out through the CLI without touching legacy vault entries', async () => {
    const context = ctx();
    await context.vault.set('oauth/claude-code/access_token', 'legacy-secret');
    let calls = 0;
    __setClaudeCommandRunner(async (_exe, args) => {
      calls++;
      return args[1] === 'logout' ? ok() : ok('{"loggedIn":true}');
    });
    await expect(claudeLogout(context)).resolves.toBe(true);
    expect(await context.vault.get('oauth/claude-code/access_token')).toBe('legacy-secret');
    expect(calls).toBe(2);
  });
});
