import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@moxxy/core';
import type { VaultStore } from '@moxxy/plugin-vault';
import type { ParsedArgv } from '../argv.js';
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
});
