import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@moxxy/core';
import type { VaultStore } from '@moxxy/plugin-vault';
import type { ParsedArgv } from '../argv.js';
import { createLoginStreamScanner, type ProviderAuthContext } from '@moxxy/sdk';
import { runLoginLogout, runLoginProvider, runLoginStatus } from './login.js';

const status = vi.fn(async () => ({ accountId: 'person@example.test', authState: 'ready', message: 'signed in' }));
const login = vi.fn(async () => ({ accountId: 'person@example.test' }));
const logout = vi.fn(async () => true);
const provider = {
  name: 'subscription-provider', models: [], createClient: vi.fn(),
  auth: { kind: 'oauth' as const, status, login, logout },
};
const session = { providers: { list: () => [provider] }, requirements: { setRuntime: vi.fn(), clearRuntime: vi.fn() } } as unknown as Session;
const vault = { open: async () => undefined, get: async () => null, set: async () => undefined } as unknown as VaultStore;
const argv = { positional: ['status', provider.name], flags: {} } as ParsedArgv;

describe('moxxy login', () => {
  it('delegates status, login, and logout to an arbitrary provider descriptor', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await runLoginStatus(argv, session, vault, {})).toBe(0);
    expect(await runLoginProvider(argv, provider.name, session, vault, {})).toBe(0);
    expect(await runLoginLogout(provider.name, session, vault, {})).toBe(0);
    expect(status).toHaveBeenCalled();
    expect(login).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
    write.mockRestore();
  });

  it('emits an auth_url marker and disables child browser opening for a desktop-hosted login', async () => {
    const url = 'https://auth.example.test/authorize?state=opaque';
    let received: ProviderAuthContext | undefined;
    const hostedProvider = {
      name: 'hosted-provider',
      models: [],
      createClient: vi.fn(),
      auth: {
        kind: 'oauth' as const,
        login: vi.fn(async (ctx: ProviderAuthContext) => {
          received = ctx;
          ctx.onAuthUrl?.(url);
          return {};
        }),
      },
    };
    const hostedSession = {
      providers: { list: () => [hostedProvider] },
      requirements: { setRuntime: vi.fn() },
    } as unknown as Session;
    const chunks: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    const hostedArgv = {
      positional: [hostedProvider.name],
      flags: { 'stdin-prompts': true },
    } as unknown as ParsedArgv;

    expect(await runLoginProvider(hostedArgv, hostedProvider.name, hostedSession, vault, {})).toBe(0);

    expect(received?.noOpen).toBe(true);
    expect(received?.onAuthUrl).toBeTypeOf('function');
    const scanner = createLoginStreamScanner();
    const items = chunks.flatMap((chunk) => [...scanner.push(chunk)]);
    expect(items).toContainEqual({ type: 'auth_url', url });
    write.mockRestore();
  });

  it('preserves standalone browser ownership outside desktop-hosted mode', async () => {
    let received: ProviderAuthContext | undefined;
    const standaloneProvider = {
      name: 'standalone-provider',
      models: [],
      createClient: vi.fn(),
      auth: {
        kind: 'oauth' as const,
        login: vi.fn(async (ctx: ProviderAuthContext) => {
          received = ctx;
          return {};
        }),
      },
    };
    const standaloneSession = {
      providers: { list: () => [standaloneProvider] },
      requirements: { setRuntime: vi.fn() },
    } as unknown as Session;
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const standaloneArgv = {
      positional: [standaloneProvider.name],
      flags: { browser: true },
    } as unknown as ParsedArgv;

    expect(
      await runLoginProvider(standaloneArgv, standaloneProvider.name, standaloneSession, vault, {}),
    ).toBe(0);

    expect(received?.noOpen).toBeUndefined();
    expect(received?.onAuthUrl).toBeUndefined();
    write.mockRestore();
  });
});
