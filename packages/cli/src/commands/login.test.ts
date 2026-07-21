import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoxxyConfig } from '@moxxy/config';
import type { Session } from '@moxxy/core';
import type { VaultStore } from '@moxxy/plugin-vault';
import { __setClaudeCommandRunner, claudeCodeProviderDef } from '@moxxy/plugin-provider-claude-code';
import type { ParsedArgv } from '../argv.js';
import { runLoginLogout, runLoginProvider, runLoginStatus } from './login.js';

const writes: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  writes.length = 0;
});

function argv(): ParsedArgv {
  return { positional: ['status', 'claude-code'], flags: {} } as ParsedArgv;
}

function session(): Session {
  return {
    providers: { list: () => [claudeCodeProviderDef] },
    requirements: { setRuntime: vi.fn(), clearRuntime: vi.fn() },
  } as unknown as Session;
}

function vault(): VaultStore {
  return {
    open: async () => undefined,
    get: async () => null,
    set: async () => undefined,
  } as unknown as VaultStore;
}

async function renderStatus(
  result: { code: number; stdout: string; stderr: string; error?: NodeJS.ErrnoException },
  config: MoxxyConfig = {},
): Promise<string> {
  __setClaudeCommandRunner(async () => result);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });
  expect(await runLoginStatus(argv(), session(), vault(), config)).toBe(0);
  return writes.join('');
}

describe('moxxy login status', () => {
  it('renders a missing Claude executable', async () => {
    const output = await renderStatus({
      code: 1,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
    });
    expect(output).toContain('claude-code');
    expect(output).toContain('missing');
    expect(output).toContain('executable not found');
  });

  it('renders a signed-out Claude CLI', async () => {
    const output = await renderStatus({ code: 0, stdout: '{"loggedIn":false}', stderr: '' });
    expect(output).toContain('signed-out');
    expect(output).toContain('installed but signed out');
  });

  it('passes a configured executable intact through login and logout', async () => {
    const executable = '/Applications/Claude Code/bin/claude';
    const seen: string[] = [];
    __setClaudeCommandRunner(async (value, args) => {
      seen.push(value);
      return args[1] === 'logout'
        ? { code: 0, stdout: '', stderr: '' }
        : { code: 0, stdout: '{"loggedIn":true}', stderr: '' };
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await runLoginProvider(argv(), 'claude-code', session(), vault(), { executable })).toBe(0);
    expect(await runLoginLogout('claude-code', session(), vault(), { executable })).toBe(0);
    expect(seen).toEqual([executable, executable, executable]);
  });

  it('renders a signed-in account and passes the configured executable intact', async () => {
    const executable = '/Applications/Claude Code/bin/claude';
    const seen: string[] = [];
    __setClaudeCommandRunner(async (value) => {
      seen.push(value);
      return { code: 0, stdout: '{"loggedIn":true,"email":"me@example.test"}', stderr: '' };
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const config = {
      plugins: { provider: { items: { 'claude-code': { config: { executable } } } } },
    } satisfies MoxxyConfig;
    expect(await runLoginStatus(argv(), session(), vault(), config)).toBe(0);
    expect(writes.join('')).toContain('me@example.test');
    expect(seen).toEqual([executable]);
  });
});
